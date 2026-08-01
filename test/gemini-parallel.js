// gemini-parallel.js — with geminiParallel=true each file cleans in its OWN Gemini tab
// (no mutex queue). Verify both files still finish with correct output, and that the run
// actually opened more than one Gemini page (i.e. it didn't silently fall back to serial).
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const { spawnSync } = require('child_process');
const sel = require('../src/main/selectors');
const { start } = require('./fixtures/server');
const { Orchestrator } = require('../src/main/pipeline/orchestrator');

(async () => {
  const audio = '/tmp/kateb-tone.mp3';
  if (!fs.existsSync(audio)) spawnSync(require('ffmpeg-static'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', audio]);
  const audioA = path.join(os.tmpdir(), 'kateb-gp-A.mp3'), audioB = path.join(os.tmpdir(), 'kateb-gp-B.mp3');
  fs.copyFileSync(audio, audioA); fs.copyFileSync(audio, audioB);

  const srv = await start();
  sel.notebooklm.home = srv.base + '/';
  sel.notebooklm.notebookUrl = (id) => srv.base + '/notebook/' + id;
  sel.gemini.home = srv.base + '/gemini';

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-gp-'));
  try { fs.symlinkSync(path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(userData, 'ms-playwright'), 'dir'); } catch (_) {}
  process.env.KATEB_HEADLESS = '1';

  const cfg = require('../src/main/config').defaults();
  cfg.output.dir = path.join(userData, 'out'); cfg.throttleMs = 20; cfg.chunkWords = 200; cfg.concurrency = 2;
  cfg.geminiParallel = true;   // the option under test

  const events = [];
  const orch = new Orchestrator({ userDataDir: userData, config: cfg, emit: (e) => events.push(e) });
  // parallel mode must NOT go through the serial mutex — spy to prove it
  let withGeminiCalls = 0;
  const origWG = orch.withGemini.bind(orch);
  orch.withGemini = (fn) => { withGeminiCalls++; return origWG(fn); };
  await orch.runQueue([
    { id: 'A', path: audioA, meta: { title: 'الف', date: '' } },
    { id: 'B', path: audioB, meta: { title: 'ب', date: '' } }
  ]);
  await orch.shutdown().catch(() => {});
  await srv.close();

  const errs = events.filter((e) => e.type === 'file-error');
  if (errs.length) { console.error('errors:', errs.map((e) => e.fileId + ': ' + e.error)); process.exit(1); }
  const doneA = events.find((e) => e.type === 'file-done' && e.fileId === 'A');
  const doneB = events.find((e) => e.type === 'file-done' && e.fileId === 'B');
  assert(doneA && doneB, 'both files finish in geminiParallel mode');
  for (const p of [...doneA.outputs, ...doneB.outputs]) assert(fs.existsSync(p), 'output exists: ' + p);
  // parallel mode cleans on per-file tabs, so the serial mutex is never used
  assert.strictEqual(withGeminiCalls, 0, 'geminiParallel must bypass the serial mutex (withGemini called ' + withGeminiCalls + '×)');

  console.log('geminiParallel: both cleaned in own tabs, outputs written, mutex bypassed ✓');
  console.log('\nGEMINI-PARALLEL TEST PASSED ✓');
})().catch((e) => { console.error('GEMINI-PARALLEL FAILED:', e.stack || e); process.exit(1); });
