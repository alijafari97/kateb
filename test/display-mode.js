// display-mode.js — the background/visible toggle must actually change the browser:
// once the setting flips, the next run relaunches with the new visibility (Bug 2).
// We can't open a *visible* browser in headless CI, so we verify the DECISION logic:
// launchedHeadless is tracked, syncDisplayMode drops the browser only on a real mismatch,
// and resetBrowser refuses to yank a browser out from under a running job.
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const sel = require('../src/main/selectors');
const { start } = require('./fixtures/server');
const { Orchestrator } = require('../src/main/pipeline/orchestrator');

(async () => {
  const srv = await start();
  sel.notebooklm.home = srv.base + '/';
  sel.notebooklm.notebookUrl = (id) => srv.base + '/notebook/' + id;
  sel.gemini.home = srv.base + '/gemini';

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-disp-'));
  try { fs.symlinkSync(path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(userData, 'ms-playwright'), 'dir'); } catch (_) {}
  process.env.KATEB_HEADLESS = '1';

  const cfg = require('../src/main/config').defaults();
  cfg.output.dir = path.join(userData, 'out'); cfg.throttleMs = 10;
  cfg.showBrowser = false; // background

  const orch = new Orchestrator({ userDataDir: userData, config: cfg, emit: () => {} });
  try {
    // 1) background launch is hidden, browser present, mode recorded
    await orch.ensureBrowser();
    assert.strictEqual(orch.launchedHeadless, true, 'background launch is headless');
    assert(orch.browser && orch.browserReady, 'browser up after launch');

    // 2) same setting -> syncDisplayMode keeps the browser (no needless relaunch)
    await orch.syncDisplayMode();
    assert(orch.browser && orch.browserReady, 'browser kept when mode matches');

    // 3) flip to "show browser" -> syncDisplayMode drops it so the next run relaunches visible
    orch.config.showBrowser = true;
    await orch.syncDisplayMode();
    assert.strictEqual(orch.browserReady, null, 'browserReady cleared on mode change');
    assert.strictEqual(orch.browser, null, 'browser closed on mode change');

    // 4) resetBrowser is a no-op while a job is running (never yank a live browser)
    orch.config.showBrowser = false;      // keep the relaunch hidden (CI has no display)
    await orch.ensureBrowser();
    orch.running = 1;                     // pretend a file is mid-flight
    const didReset = await orch.resetBrowser();
    assert.strictEqual(didReset, false, 'resetBrowser refuses while running > 0');
    assert(orch.browser, 'browser survives a mid-run reset attempt');
    orch.running = 0;
  } finally {
    await orch.shutdown().catch(() => {});
    await srv.close();
  }

  console.log('mode tracked ✓  match=keep ✓  mismatch=drop ✓  mid-run reset refused ✓');
  console.log('\nDISPLAY-MODE TEST PASSED ✓');
})().catch((e) => { console.error('DISPLAY-MODE FAILED:', e.stack || e); process.exit(1); });
