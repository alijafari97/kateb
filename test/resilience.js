// resilience.js — prove the orchestrator survives a browser death: kill the Chromium
// context mid-run and assert the file still finishes (relaunch + retry), not errors.
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const { spawnSync } = require('child_process');
const sel = require('../src/main/selectors');
const { start } = require('./fixtures/server');
const { Orchestrator } = require('../src/main/pipeline/orchestrator');

(async () => {
  const audio = process.argv[2] || '/tmp/kateb-tone.mp3';
  if (!fs.existsSync(audio)) spawnSync(require('ffmpeg-static'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', audio]);

  const srv = await start();
  sel.notebooklm.home = srv.base + '/';
  sel.notebooklm.notebookUrl = (id) => srv.base + '/notebook/' + id;
  sel.gemini.home = srv.base + '/gemini';

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-res-'));
  try { fs.symlinkSync(path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(userData, 'ms-playwright'), 'dir'); } catch (_) {}
  process.env.KATEB_HEADLESS = '1';

  const cfg = require('../src/main/config').defaults();
  cfg.output.dir = path.join(userData, 'out'); cfg.throttleMs = 20; cfg.chunkWords = 200; cfg.concurrency = 1;

  const events = [];
  const orch = new Orchestrator({ userDataDir: userData, config: cfg, emit: (e) => events.push(e) });

  // kill the browser once, shortly after it comes up, to simulate a mid-run crash
  let killed = false;
  const origEmit = orch.emit;
  orch.emit = (e) => {
    origEmit(e);
    if (!killed && e.type === 'stage' && e.stage === 'transcribe' && e.status === 'now') {
      killed = true;
      setTimeout(() => { if (orch.browser) orch.browser.close().catch(() => {}); }, 200); // yank it mid-transcribe
    }
  };

  const job = { id: 'r1', path: audio, meta: { title: 'فایلِ مقاوم', date: '۱۴۰۵/۰۱/۰۱' } };
  await orch.runJob(job);
  await orch.shutdown().catch(() => {});
  await srv.close();

  const err = events.find((e) => e.type === 'file-error');
  const done = events.find((e) => e.type === 'file-done');
  const relaunched = events.filter((e) => e.type === 'browser' && e.status === 'launching').length;
  assert(!err, 'file should not end in error after a browser death: ' + (err && err.error));
  assert(done, 'file should finish via relaunch+retry');
  for (const p of done.outputs) assert(fs.existsSync(p), 'output written: ' + p);
  assert(relaunched >= 2, 'browser relaunched at least once after the kill (saw ' + relaunched + ' launches)');
  assert(killed, 'the kill actually fired');

  console.log(`killed mid-run, relaunched, file finished ✓  (${done.outputs.map((p) => path.basename(p)).join(', ')})`);
  console.log('\nRESILIENCE TEST PASSED ✓');
})().catch((e) => { console.error('RESILIENCE FAILED:', e.stack || e); process.exit(1); });
