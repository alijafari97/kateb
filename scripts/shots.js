// shots.js — render the real renderer UI (with window.kateb stubbed + sample data) and
// screenshot all four screens, so the app can be *seen* without a display.
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');
const { DEFAULT_PROMPT } = require('../src/main/pipeline/prompt');

const SETTINGS = { cleaningPrompt: DEFAULT_PROMPT, output: { docx: true, md: true, dir: '~/Documents/مجالس' }, instituteHeader: '', splitAboveMinutes: 150, chunkWords: 2200 };
const stub = `window.kateb = {
  getSettings: async () => (${JSON.stringify(SETTINGS)}),
  defaultSettings: async () => (${JSON.stringify(SETTINGS)}),
  saveSettings: async () => {}, pickFolder: async () => null, pickAudio: async () => [],
  warmup: async () => ({ ok: true }), startJobs: async () => ({ started: true }),
  openPath: () => {}, showItem: () => {}, pathForFile: (f) => f.name, onEvent: () => () => {}
};`;

(async () => {
  const outDir = path.join(__dirname, '..', 'assets', 'shots');
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage({ viewport: { width: 980, height: 720 }, deviceScaleFactor: 2 });
  await p.addInitScript(stub);
  await p.goto('file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await p.waitForTimeout(400);
  const shot = (n) => p.screenshot({ path: path.join(outDir, n) });

  // 1) login
  await shot('1-login.png');

  // 2) main with sample files + metadata
  await p.evaluate(() => {
    addFiles(['/Users/ali/مجالس/Tajarode-Nafs-7.mp3', '/Users/ali/مجالس/Dars-Akhlaq-12.mp3']);
    show('main');
    const c = document.querySelectorAll('.filecard');
    if (c[0]) { c[0].querySelector('[data-k=title]').value = 'جلسهٔ تجردِ نفس ۷'; c[0].querySelector('[data-k=date]').value = '۱۴۰۵/۰۵/۰۹'; }
    if (c[1]) { c[1].querySelector('[data-k=title]').value = 'درسِ اخلاق ۱۲'; c[1].querySelector('[data-k=date]').value = '۱۴۰۵/۰۵/۱۰'; }
  });
  await p.waitForTimeout(150);
  await shot('2-main.png');

  // 3) progress mid-run
  await p.evaluate(() => {
    buildProgressCards(); show('progress');
    setStep('f1', 'prepare', 'done', '۲ تکه'); setStep('f1', 'transcribe', 'done'); setStep('f1', 'clean', 'now', 'تکه ۴/۷');
    setStep('f2', 'prepare', 'done', '۱ تکه'); setStep('f2', 'transcribe', 'now');
    const cards = document.querySelectorAll('.pcard');
    cards[0].querySelector('.plog').textContent = 'تمیزکاریِ تکه ۴ از ۷ در Gemini…';
    const v = document.createElement('div'); v.className = 'warnrow'; v.style.color = '#2F5A4B';
    v.textContent = '✓ بررسیِ کامل‌بودن: تکه‌های ۱ تا ۳ تأیید شد';
    cards[0].appendChild(v);
    cards[1].querySelector('.plog').textContent = 'رونویسیِ تکهٔ ۱ در NotebookLM…';
  });
  await p.waitForTimeout(150);
  await shot('3-progress.png');

  // 4) settings
  await p.evaluate(async () => { await loadSettings(); show('settings'); });
  await p.waitForTimeout(200);
  await shot('4-settings.png');

  await b.close();
  console.log('wrote 4 screenshots to assets/shots/');
})();
