// renderer-nav.js — drive the REAL renderer (index.html + app.js) with a recording stub
// to prove the two reported bugs are fixed, with no Google/NotebookLM needed:
//   (1) after «شروع», the «صوت‌ها» nav returns to the live PROGRESS screen (not a blank start)
//   (2) flipping «show browser» persists the setting AND resets the browser so the next run honors it
const assert = require('assert');
const path = require('path');
const { chromium } = require('playwright-core');

const stub = `
  window.__calls = { saveSettings: [], resetBrowser: 0, startJobs: [], retryJob: [] };
  window.kateb = {
    pathForFile: (f) => f.name,
    getSettings: async () => ({ cleaningPrompt:'x', output:{docx:true,md:true,dir:'~/د'}, instituteHeader:'', splitAboveMinutes:150, chunkWords:2200, showBrowser:false, concurrency:2, maxAudioMB:45 }),
    saveSettings: async (p) => { window.__calls.saveSettings.push(p); },
    defaultSettings: async () => ({}),
    warmup: async () => ({ ok:true }),
    resetBrowser: async () => { window.__calls.resetBrowser++; return { ok:true, reset:true }; },
    pickFolder: async () => null, pickAudio: async () => [],
    openPath: () => {}, showItem: () => {},
    startJobs: async (j) => { window.__calls.startJobs.push(j); return { started:true }; },
    retryJob: async (j) => { window.__calls.retryJob.push(j); return { started:true }; },
    onEvent: () => () => {}
  };
`;
const isActive = (p, view) => p.evaluate((v) => document.querySelector('[data-view=' + v + ']').classList.contains('active'), view);

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  await p.addInitScript(stub);
  await p.goto('file://' + path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  await p.waitForTimeout(300);

  /* ---- Bug 1: nav returns to the live run, not a blank add-screen ---- */
  await p.evaluate(() => { show('main'); addFiles(['/x/جلسه.mp3']); });
  await p.click('#startBtn');
  await p.waitForTimeout(120);
  assert(await isActive(p, 'progress'), 'after شروع, the progress screen is shown');
  assert.strictEqual(await p.evaluate(() => window.__calls.startJobs.length), 1, 'startJobs called once');

  await p.click('.navbtn[data-go=settings]');
  await p.waitForTimeout(50);
  assert(await isActive(p, 'settings'), 'settings opens');
  await p.click('.navbtn[data-go=main]');          // «صوت‌ها»
  await p.waitForTimeout(50);
  assert(await isActive(p, 'progress'), 'BUG1: صوت‌ها returns to progress (not a blank start)');
  assert(await p.evaluate(() => document.querySelector('#startBtn').disabled), 'شروع is locked while a batch runs');

  /* ---- Bug 2: the show-browser toggle persists + resets the browser ---- */
  await p.reload();                                 // fresh state (runStarted/busy cleared)
  await p.waitForTimeout(300);
  await p.evaluate(() => show('main'));
  await p.click('#mainShowBrowser');                // turn it on
  await p.waitForTimeout(120);
  const calls = await p.evaluate(() => window.__calls);
  assert(calls.saveSettings.some((c) => c && c.showBrowser === true), 'BUG2: toggle persists showBrowser=true');
  assert(calls.resetBrowser >= 1, 'BUG2: toggle resets the browser so the next run opens visible');

  await b.close();
  console.log('BUG1 nav→progress ✓   busy-lock ✓   BUG2 toggle persist+reset ✓');
  console.log('\nRENDERER-NAV TEST PASSED ✓');
})().catch((e) => { console.error('RENDERER-NAV FAILED:', e.stack || e); process.exit(1); });
