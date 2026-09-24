// app.js — renderer logic: screen nav, adding files, live pipeline progress, settings.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const K = window.kateb;

const STAGES = [
  { key: 'prepare', label: 'آماده‌سازی صوت' },
  { key: 'transcribe', label: 'رونویسی · NotebookLM' },
  { key: 'clean', label: 'تمیزکاری · Gemini' },
  { key: 'build', label: 'ساخت سند' }
];

let files = [];      // {id, path, name, day, session, date}
let cards = {};      // fileId -> {el, steps:{stage:el}, bar, log, done:Set}
let uid = 0;

let runStarted = false;      // once a run begins, "صوت‌ها" returns to the live progress, not a blank start
let curShowBrowser = false;  // last effective display mode (reset the browser only when it actually changes)
let busy = false;            // a batch is running — lock "شروع" so nothing re-runs on top of it

function show(view) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === view));
  // keep "صوت‌ها" highlighted on the progress screen too (it has no nav button of its own)
  $$('.navbtn').forEach((b) => b.classList.toggle('on', b.dataset.go === view || (b.dataset.go === 'main' && view === 'progress')));
  if (view === 'main' || view === 'progress') syncShowBrowser();
}
async function syncShowBrowser() {
  try { const s = await K.getSettings(); curShowBrowser = !!s.showBrowser; $('#mainShowBrowser').checked = curShowBrowser; } catch (_) {}
}
// Flip the display mode everywhere and drop the idle browser so the NEXT run opens visible/hidden per the choice.
async function applyShowBrowser(val) {
  val = !!val;
  await K.saveSettings({ showBrowser: val });
  $('#mainShowBrowser').checked = val;
  const st = $('#setShowBrowser'); if (st) st.checked = val;
  if (val !== curShowBrowser) { curShowBrowser = val; try { await K.resetBrowser(); } catch (_) {} }
}
$('#mainShowBrowser').addEventListener('change', (e) => applyShowBrowser(e.target.checked));
syncShowBrowser();

/* ---------------- login ---------------- */
$('#loginBtn').addEventListener('click', async () => {
  const btn = $('#loginBtn'), st = $('#loginStatus');
  btn.disabled = true; st.className = 'status'; st.textContent = 'در حالِ باز کردنِ مرورگر…';
  const r = await K.warmup();
  if (r && r.ok) { st.className = 'status ok'; st.textContent = 'آماده شد ✓'; setTimeout(() => show('main'), 600); }
  else { st.className = 'status err'; st.textContent = 'مشکلی پیش آمد: ' + (r && r.error || 'نامشخص'); btn.disabled = false; }
});

/* ---------------- add files ---------------- */
const drop = $('#drop');
drop.addEventListener('click', async () => addFiles(await K.pickAudio()));
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const paths = [...(e.dataTransfer.files || [])].map((f) => K.pathForFile(f)).filter(Boolean);
  if (paths.length) addFiles(paths);
});

function addFiles(paths) {
  for (const p of paths || []) {
    if (files.some((f) => f.path === p)) continue;
    const fname = p.split(/[\\/]/).pop();
    files.push({ id: 'f' + (++uid), path: p, name: fname, title: fname.replace(/\.[^.]+$/, ''), date: '' });
  }
  renderFiles();
}

function renderFiles() {
  const list = $('#fileList'); list.innerHTML = '';
  for (const f of files) {
    const el = document.createElement('div');
    el.className = 'filecard';
    el.innerHTML = `
      <div class="fhead">
        <div class="ic">♪</div>
        <div style="min-width:0"><div class="fn" title="${f.name}">${f.name}</div><div class="fmeta">${f.path}</div></div>
        <button class="rm" title="حذف">✕</button>
      </div>
      <div class="frow2">
        <div class="f"><label>عنوانِ سند</label><input data-k="title" placeholder="نامِ جلسه / سند" value="${f.title}"></div>
        <div class="f"><label>تاریخ (اختیاری)</label><input data-k="date" placeholder="۱۴۰۵/۰۵/۰۹" value="${f.date}"></div>
      </div>`;
    el.querySelector('.rm').addEventListener('click', () => { files = files.filter((x) => x !== f); renderFiles(); });
    $$('[data-k]', el).forEach((inp) => inp.addEventListener('input', () => { f[inp.dataset.k] = inp.value; }));
    list.appendChild(el);
  }
  $('#fileCount').textContent = busy ? 'در حالِ اجرا…' : (files.length ? `${files.length} فایل` : '');
  $('#startBtn').disabled = busy || files.length === 0;
}

/* ---------------- start ---------------- */
$('#startBtn').addEventListener('click', async () => {
  if (busy || !files.length) return;              // never start a second batch over a running one
  const jobs = files.map((f) => ({ id: f.id, path: f.path, meta: { title: f.title, date: f.date } }));
  busy = true; runStarted = true;
  buildProgressCards();
  show('progress');
  await K.startJobs(jobs);
  files = []; renderFiles();                       // submitted files now live on the progress screen; keep add-screen clean
});
$('#backBtn').addEventListener('click', () => show('main'));

function buildProgressCards() {
  const list = $('#progList'); list.innerHTML = ''; cards = {};
  for (const f of files) {
    const el = document.createElement('div');
    el.className = 'pcard';
    const steps = STAGES.map((s) => `<div class="st wait" data-st="${s.key}"><span class="si">${STAGES.indexOf(s)+1}</span><span class="sl">${s.label}</span><span class="sr"></span></div>`).join('');
    el.innerHTML = `<div class="phead"><div class="pt">${f.name}</div><button class="retry hidden">↻ از اول</button></div>
      <div class="stepper">${steps}</div><div class="prog"><i></i></div><div class="plog"></div><div class="outs"></div>`;
    list.appendChild(el);
    const stepEls = {}; $$('[data-st]', el).forEach((s) => (stepEls[s.dataset.st] = s));
    const card = { el, f, steps: stepEls, bar: $('.prog i', el), log: $('.plog', el), outs: $('.outs', el), retry: $('.retry', el), done: new Set() };
    card.retry.addEventListener('click', () => retryFile(f.id));
    cards[f.id] = card;
  }
}

function resetCard(fileId) {
  const c = cards[fileId]; if (!c) return;
  c.done = new Set();
  for (const k in c.steps) { c.steps[k].className = 'st wait'; const sr = $('.sr', c.steps[k]); if (sr) sr.textContent = ''; }
  c.bar.style.width = '0'; c.log.textContent = ''; c.outs.innerHTML = '';
  c.el.querySelectorAll('.warnrow, .errrow').forEach((n) => n.remove());
  c.retry.classList.add('hidden');
}

function retryFile(fileId) {
  const c = cards[fileId]; if (!c) return;
  resetCard(fileId);
  const f = c.f;
  K.retryJob({ id: f.id, path: f.path, meta: { title: f.title, date: f.date } });
}

function setStep(fileId, stage, status, detail) {
  const c = cards[fileId]; if (!c) return;
  const s = c.steps[stage]; if (!s) return;
  s.className = 'st ' + status;
  if (detail) $('.sr', s).textContent = detail;
  else if (status === 'done') $('.sr', s).textContent = 'تمام';
  if (status === 'done' || status === 'warn') c.done.add(stage);
  c.bar.style.width = Math.round((c.done.size / STAGES.length) * 100) + '%';
}

/* ---------------- live events ---------------- */
K.onEvent((evt) => {
  if (evt.type === 'challenge') {
    $('#loginChallenge').classList.remove('hidden');
    $('#progChallenge').classList.remove('hidden');
    const st = $('#loginStatus'); if (st) { st.className = 'status'; st.textContent = 'منتظرِ ورودِ شما در پنجرهٔ مرورگر…'; }
  }
  if (evt.type === 'browser' && evt.status === 'ready') {
    $('#loginChallenge').classList.add('hidden');
    $('#progChallenge').classList.add('hidden');
  }
  if (evt.type === 'stage') setStep(evt.fileId, evt.stage, evt.status, evt.detail);
  if (evt.type === 'log' && evt.fileId && cards[evt.fileId]) cards[evt.fileId].log.textContent = evt.msg;
  if (evt.type === 'file-done') {
    const c = cards[evt.fileId]; if (!c) return;
    setStep(evt.fileId, 'build', 'done');
    for (const p of evt.outputs || []) {
      const o = document.createElement('span'); o.className = 'o';
      o.textContent = '📄 ' + p.split(/[\\/]/).pop();
      o.title = p; o.addEventListener('click', () => K.showItem(p));
      c.outs.appendChild(o);
    }
    if (evt.warnings && evt.warnings.length) {
      const nums = evt.warnings.map((x) => x.index).filter(Boolean).join('، ');
      const w = document.createElement('div'); w.className = 'warnrow';
      w.textContent = `⚠ ${evt.warnings.length} بخش کامل تأیید نشد${nums ? ` (بخشِ ${nums})` : ''} — در سند دنبالِ نشانِ ⚠️ بگرد؛ همان‌جا را با صوت بسنج.`;
      c.el.appendChild(w);
    }
    c.retry.classList.remove('hidden');
  }
  if (evt.type === 'file-error') {
    const c = cards[evt.fileId]; if (!c) return;
    const er = document.createElement('div'); er.className = 'errrow';
    er.textContent = 'خطا: ' + evt.error; c.el.appendChild(er);
    c.retry.classList.remove('hidden');
  }
  if (evt.type === 'queue-done') { busy = false; renderFiles(); } // batch finished — "شروع" unlocks for a new one
});

/* ---------------- settings ---------------- */
// Top-bar nav. "صوت‌ها" returns to the live run once started (so leaving for تنظیمات and
// coming back doesn't dump you on a blank add-screen that looks like it restarted).
$$('.navbtn').forEach((b) => b.addEventListener('click', () => {
  const go = b.dataset.go;
  if (go === 'settings') { loadSettings(); show('settings'); }
  else if (go === 'main') { show(runStarted ? 'progress' : 'main'); }
}));

async function loadSettings() {
  const s = await K.getSettings();
  $('#setPrompt').value = s.cleaningPrompt;
  $('#setDocx').checked = !!s.output.docx;
  $('#setMd').checked = !!s.output.md;
  $('#setDir').value = s.output.dir;
  $('#setHeader').value = s.instituteHeader || '';
  $('#setSplit').value = s.splitAboveMinutes;
  $('#setChunk').value = s.chunkWords;
  $('#setShowBrowser').checked = !!s.showBrowser; curShowBrowser = !!s.showBrowser;
  $('#setConcurrency').value = s.concurrency || 2;
  $('#setMaxMB').value = s.maxAudioMB || 45;
  $('#setGeminiParallel').checked = !!s.geminiParallel;
  $('#setGeminiModel').value = s.geminiModel || 'Pro';
  $('#setMinRatio').value = s.minLengthRatio || 0.85;
}
$('#pickDir').addEventListener('click', async () => { const d = await K.pickFolder(); if (d) $('#setDir').value = d; });
$('#saveSet').addEventListener('click', async () => {
  await K.saveSettings({
    cleaningPrompt: $('#setPrompt').value,
    output: { docx: $('#setDocx').checked, md: $('#setMd').checked, dir: $('#setDir').value },
    instituteHeader: $('#setHeader').value,
    splitAboveMinutes: +$('#setSplit').value || 150,
    chunkWords: +$('#setChunk').value || 2200,
    showBrowser: $('#setShowBrowser').checked,
    concurrency: +$('#setConcurrency').value || 2,
    maxAudioMB: +$('#setMaxMB').value || 45,
    geminiParallel: $('#setGeminiParallel').checked,
    geminiModel: $('#setGeminiModel').value || 'Pro',
    minLengthRatio: Math.min(1, Math.max(0.2, +$('#setMinRatio').value || 0.85))
  });
  // if the display mode changed here, drop the idle browser so the next run honors it
  if ($('#setShowBrowser').checked !== curShowBrowser) { curShowBrowser = $('#setShowBrowser').checked; try { await K.resetBrowser(); } catch (_) {} }
  const st = $('#setSaved'); st.className = 'status ok'; st.textContent = 'ذخیره شد ✓'; setTimeout(() => (st.textContent = ''), 1800);
});
$('#resetSet').addEventListener('click', async () => {
  const d = await K.defaultSettings();
  $('#setPrompt').value = d.cleaningPrompt; $('#setDocx').checked = d.output.docx; $('#setMd').checked = d.output.md;
  $('#setDir').value = d.output.dir; $('#setSplit').value = d.splitAboveMinutes; $('#setChunk').value = d.chunkWords;
  $('#setShowBrowser').checked = d.showBrowser; $('#setConcurrency').value = d.concurrency; $('#setMaxMB').value = d.maxAudioMB;
  $('#setGeminiParallel').checked = d.geminiParallel;
  $('#setGeminiModel').value = d.geminiModel; $('#setMinRatio').value = d.minLengthRatio;
});
