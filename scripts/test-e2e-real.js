// test-e2e-real.js <audio> — full real pipeline (real NLM + real Gemini -> docx/md)
// using the app's logged-in profile, headless. This is the real end-to-end proof.
const path = require('path'), os = require('os'), fs = require('fs');
const APP = path.join(os.homedir(), '.config', 'کاتب');

// make sure chromium is findable at the app's browser path (symlink the dev cache if needed)
const appBrowsers = path.join(APP, 'ms-playwright');
process.env.PLAYWRIGHT_BROWSERS_PATH = appBrowsers;
try {
  const { chromium } = require('playwright-core');
  if (!fs.existsSync(chromium.executablePath())) throw new Error('absent');
} catch (_) {
  try { fs.rmSync(appBrowsers, { recursive: true, force: true }); } catch (_) {}
  try { fs.symlinkSync(path.join(os.homedir(), '.cache', 'ms-playwright'), appBrowsers, 'dir'); } catch (_) {}
}

const { Orchestrator } = require('../src/main/pipeline/orchestrator');
const config = require('../src/main/config');

(async () => {
  config.init(APP);
  const cfg = config.load();
  cfg.output.dir = path.join(os.homedir(), 'Documents', 'مجالس'); // permanent, where the app puts them
  cfg.throttleMs = 400;

  const events = [];
  const orch = new Orchestrator({
    userDataDir: APP, config: cfg,
    emit: (e) => {
      events.push(e);
      if (e.type === 'stage') console.log('STAGE:', e.stage, e.status, e.detail || '');
      else if (e.type === 'log') console.log('  ·', e.msg);
      else if (e.type === 'file-done') console.log('FILE-DONE:', e.outputs);
      else if (e.type === 'file-error') console.log('FILE-ERROR:', e.error);
      else if (e.type === 'challenge') console.log('!! CHALLENGE:', e.reason);
    }
  });
  const job = { id: 'f1', path: process.argv[2], meta: { day: 'تجرد نفس ۷', session: '', date: '' } };
  console.log('starting E2E for:', job.path);
  await orch.runJob(job);
  await orch.shutdown();

  const done = events.find((e) => e.type === 'file-done');
  if (done) {
    console.log('\n✅ E2E PASSED');
    for (const p of done.outputs) console.log('   ', p, fs.existsSync(p) ? '(' + Math.round(fs.statSync(p).size / 1024) + 'KB)' : '(MISSING)');
  } else {
    console.log('\n❌ E2E did not finish (see FILE-ERROR above)');
    process.exit(1);
  }
})().catch((e) => { console.error('E2E THREW:', e.stack || e); process.exit(1); });
