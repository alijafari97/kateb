// notebooklm.js — drive NotebookLM to transcribe an audio file, entirely through the
// web UI. Ported from the field-proven openclaw scripts (nlm_upload3 / nlm_extract3).
//
// THE ONE RULE (learned the hard way): once the file is handed to NotebookLM we must NOT
// close or navigate the tab until the upload has fully landed — doing so aborts the
// byte transfer, and NLM then keeps a half-uploaded source that "processes" forever while
// we poll into the void. So the whole lifecycle — create → upload → wait → extract — runs
// on ONE page that stays open the entire time (each file still gets its own page, so
// parallelism is unaffected). We only ever read/click in place; never close mid-flight.
const S = require('../selectors').notebooklm;

const CREATE_FN = `(reSrc)=>{const rx=new RegExp(reSrc,'i');const b=[...document.querySelectorAll("button,[role=button]")].find(e=>rx.test((e.getAttribute("aria-label")||"")+(e.innerText||"")));if(!b)return "NO";["pointerdown","mousedown","mouseup","click"].forEach(t=>b.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})));return "OK";}`;
// Find the uploaded source chip by the file's OWN name (most reliable) OR any audio
// extension. Voice notes are .ogg/.m4a/.opus — the old ".mp3"-only match missed them and
// the app got stuck "uploading" forever even though NLM had the source ready.
const SRC_FIND_FN = `(base, reSrc)=>{
  const rx=new RegExp(reSrc,'i'); const bl=(base||'').toLowerCase();
  return [...document.querySelectorAll('button,[role=button]')].find(e=>{
    const t=((e.getAttribute('aria-label')||'')+' '+(e.textContent||'')).toLowerCase();
    return (bl.length>=3 && t.includes(bl)) || rx.test(t);
  });
}`;

async function evalRe(page, fnSrc, reSrc) {
  return page.evaluate(({ f, r }) => new Function('reSrc', 'return (' + f + ')(reSrc)')(r), { f: fnSrc, r: reSrc }).catch(() => 'NO');
}

const baseOf = (fp) => String(fp || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '').slice(0, 28);

async function hasAudioSource(page, fname) {
  return page.evaluate(({ f, base, re }) => !!new Function('base', 'reSrc', 'return (' + f + ')(base,reSrc)')(base, re),
    { f: SRC_FIND_FN, base: baseOf(fname), re: S.sourceRe.source }).catch(() => false);
}

async function clickSource(page, fname) {
  return page.evaluate(({ f, base, re }) => {
    const el = new Function('base', 'reSrc', 'return (' + f + ')(base,reSrc)')(base, re);
    if (!el) return 'NO';
    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
    return 'OK';
  }, { f: SRC_FIND_FN, base: baseOf(fname), re: S.sourceRe.source }).catch(() => 'NO');
}

async function transcriptLength(page) {
  return page.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.textContent.length : 0; }, S.transcriptSel).catch(() => 0);
}

// Create a notebook, attach the audio, wait for the transcript, and return it — all on a
// single page that is NEVER closed or navigated until the work is done (see file header).
async function transcribeFile(browser, filePath, { maxWaitMs = 30 * 60 * 1000, onLog = () => {} } = {}) {
  const p = await browser.newPage(S.home);   // this file's own page — safe to run in parallel
  try {
    await p.setViewportSize(S.minViewport);  // Sources panel collapses below ~1200px
    await p.waitForTimeout(2500);

    // NLM caps notebooks (free tier = 100); the "Create" button goes disabled when full.
    const atLimit = await p.evaluate(() => {
      const b = document.querySelector('button[aria-label*="Create" i], button.create-new-button');
      return (b && b.disabled === true) || /maximum number of notebooks|reached the maximum/i.test(document.body.innerText || '');
    }).catch(() => false);
    if (atLimit) throw new Error('به سقفِ تعدادِ نوت‌بوکِ NotebookLM رسیده‌ای — چند نوت‌بوکِ قدیمی را در notebooklm.google.com پاک کن و دوباره بزن.');

    // click "Create new notebook"
    let ok = 'NO';
    for (let i = 0; i < 6 && ok !== 'OK'; i++) {
      ok = await evalRe(p, CREATE_FN, S.createRe.source);
      if (ok !== 'OK') await p.waitForTimeout(3500);
    }
    if (ok !== 'OK') throw new Error('NLM: create-notebook button not found');

    // capture the new notebook id from the URL
    let nbid = null;
    for (let i = 0; i < 10 && !nbid; i++) {
      await p.waitForTimeout(2500);
      const m = p.url().match(/notebook\/([a-f0-9-]{20,})/i);
      if (m) nbid = m[1];
    }
    if (!nbid) throw new Error('NLM: notebook id never appeared');
    onLog(`نوت‌بوک ساخته شد (${nbid.slice(0, 8)})`);

    // Upload the audio. The "Add sources" dialog opens automatically after create
    // (?addSource=true). A TRUSTED Playwright click on "Upload files" is required to open
    // the OS file chooser — a synthetic click does not. The hidden <input type=file> only
    // appears after that click, so setInputFiles alone would fail.
    const chooserP = p.waitForEvent('filechooser', { timeout: 30000 });
    const clickUpload = async () => {
      const btn = p.locator(S.uploadButton).first();
      await btn.waitFor({ state: 'visible', timeout: 20000 });
      await btn.click({ timeout: 10000 });
    };
    try {
      await clickUpload();
    } catch (_) {
      // ensure the Add-sources dialog is actually open, then retry once
      await p.goto(S.notebookUrl(nbid) + '?addSource=true', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await p.waitForTimeout(3000);
      await clickUpload().catch(() => {});
    }
    let chooser = null;
    try { chooser = await chooserP; } catch (_) {}
    if (chooser) {
      await chooser.setFiles(filePath);
    } else {
      await p.setInputFiles('input[type="file"]', filePath).catch(() => { throw new Error('NLM: could not attach the audio file'); });
    }
    onLog('صوت انتخاب شد؛ تا پایانِ آپلود و رونویسی، این تب باز می‌ماند…');

    // --- From here: NO close, NO navigation on this page (that would abort the upload). ---
    // Poll in place: first the source chip must appear (bytes landed), then open it and let
    // the transcript fill. A stuck/incomplete upload simply times out -> the orchestrator
    // re-encodes and retries with a fresh notebook, rather than us yanking the tab.
    const start = Date.now();
    let sawSource = false, ticks = 0;
    while (Date.now() - start < maxWaitMs) {
      if (!sawSource) {
        sawSource = await hasAudioSource(p, filePath);
        if (!sawSource) {
          await p.waitForTimeout(5000);
          if (++ticks % 12 === 0) onLog('در حالِ آپلودِ صوت به NotebookLM…');
          continue;
        }
        onLog('آپلود انجام شد؛ منتظرِ پایانِ رونویسیِ سمتِ سرور…');
      }

      // open the source and poll its transcript (all in place — no navigation)
      let clicked = 'NO';
      for (let i = 0; i < 3 && clicked !== 'OK'; i++) {
        clicked = await clickSource(p, filePath);
        if (clicked !== 'OK') await p.waitForTimeout(2500);
      }
      let len = 0;
      for (let i = 0; i < 5; i++) { await p.waitForTimeout(3000); len = await transcriptLength(p); if (len > S.minTranscriptChars) break; }
      if (len > S.minTranscriptChars) {
        const raw = await p.evaluate((sel) => { const e = document.querySelector(sel); return e ? e.textContent : ''; }, S.transcriptSel);
        onLog('رونویسی آماده شد ✓');
        return stripSourceGuide(raw);
      }
      onLog('رونویسی هنوز کامل نشده؛ صبر می‌کنم…');
      await p.waitForTimeout(15000);
    }
    throw new Error('NLM: رونویسی در زمانِ مقرر کامل نشد — دوباره تلاش کن.');
  } finally {
    await p.close().catch(() => {});   // only now, when the transcript is in hand (or we truly failed)
  }
}

function stripSourceGuide(text) {
  const m = String(text || '').match(S.sourceGuideRe);
  return (m ? text.slice(m.index + m[0].length) : text).trim();
}

module.exports = { transcribeFile, stripSourceGuide, hasAudioSource, transcriptLength };
