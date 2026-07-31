// diag-paste-count.js — isolate the crash: run sendAndGet N times in a row on ONE gemini
// page (headless) and report which iteration kills the browser. If it dies around a fixed
// count, the clipboard paste is the culprit (a real problem for long, many-chunk files).
const os = require('os'), path = require('path'), fs = require('fs');
const sel = require('../src/main/selectors');
const { start } = require('../test/fixtures/server');
const { KatebBrowser } = require('../src/main/pipeline/browser');
const { ensureGemini, sendAndGet } = require('../src/main/pipeline/gemini');

const t0 = Date.now();
const log = (m) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s  ${m}`);

(async () => {
  const srv = await start();
  sel.gemini.home = srv.base + '/gemini';
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-pc-'));
  try { fs.symlinkSync(path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(userData, 'ms-playwright'), 'dir'); } catch (_) {}

  const headless = process.env.KATEB_HEADED !== '1';
  const b = await new KatebBrowser({ userDataDir: userData, throttleMs: 20, headless }).launch();
  const g = await ensureGemini(b);
  log('gemini ready, headless=' + headless);

  const N = parseInt(process.env.N || '20', 10);
  const msg = 'لطفاً این متن را تمیز کن.\n---\n' + 'یک جملهٔ آزمایشی برای تمیزکاری. '.repeat(15);
  try {
    for (let i = 1; i <= N; i++) {
      const out = await sendAndGet(g, msg + ' نوبتِ ' + i);
      log(`paste #${i} OK (reply ${out.length})`);
    }
    log('ALL ' + N + ' PASTES OK — no crash');
  } catch (e) {
    log(`CRASH at a paste: ${(e.message || e).slice(0, 70)}`);
  } finally {
    await b.close().catch(() => {});
    await srv.close();
  }
})().catch((e) => { console.error('ERR:', e.stack || e); process.exit(1); });
