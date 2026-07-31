// run-real-both.js — run the REAL app pipeline (via the orchestrator, user's profile + config)
// on the two audio files. Transcripts are already cached, so this only cleans (real Gemini)
// and builds docx/md — exactly what the app does. Sequential + headless for a clean test.
const path = require('path'), os = require('os'), fs = require('fs');
const config = require('../src/main/config');
const { Orchestrator } = require('../src/main/pipeline/orchestrator');

const APP = path.join(os.homedir(), '.config', 'Kateb');
const t0 = Date.now();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(0)}s`;

(async () => {
  config.init(APP);
  const cfg = config.load();
  cfg.concurrency = 1;                 // sequential for a clean validation
  cfg.showBrowser = process.env.KATEB_HEADED === '1';   // headless unless asked
  console.log(`config: out=${cfg.output.dir} | chunkWords=${cfg.chunkWords} | headed=${cfg.showBrowser}`);

  const orch = new Orchestrator({
    userDataDir: APP, config: cfg,
    emit: (e) => {
      if (e.type === 'stage') console.log(`${ts()} [${e.fileId}] ${e.stage}: ${e.status}${e.detail ? ' — ' + e.detail : ''}`);
      else if (e.type === 'log') console.log(`${ts()} [${e.fileId || '*'}] ${e.msg}`);
      else if (e.type === 'file-done') console.log(`${ts()} [${e.fileId}] ✅ DONE: ${e.outputs.map((p) => path.basename(p)).join(', ')} (warnings: ${e.warnings.length})`);
      else if (e.type === 'file-error') console.log(`${ts()} [${e.fileId}] ❌ ERROR: ${e.error}`);
      else if (e.type === 'browser') console.log(`${ts()} browser: ${e.status}`);
    }
  });

  const jobs = [
    { id: 'nafs7', path: '/home/nirvan/Downloads/Telegram Desktop/Tajarode Nafs 7.mp3', meta: { title: 'Tajarode Nafs 7', date: '' } },
    { id: 'nafs6', path: '/home/nirvan/Downloads/Telegram Desktop/Tajarode Nafs 6.mp3', meta: { title: 'Tajarode Nafs 6', date: '' } }
  ];
  for (const j of jobs) {
    console.log(`\n===== ${j.meta.title} =====`);
    await orch.runJob(j);
  }
  await orch.shutdown().catch(() => {});
  console.log(`\nALL DONE in ${Math.round((Date.now() - t0) / 1000)}s`);
})().catch((e) => { console.error('DRIVER FAIL:', e.stack || e); process.exit(1); });
