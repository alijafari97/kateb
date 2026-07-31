// parallel.js — run TWO files through the orchestrator with concurrency=2 and confirm
// they overlap (the second starts before the first finishes) and both produce outputs.
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const { spawnSync } = require('child_process');
const sel = require('../src/main/selectors');
const { start } = require('./fixtures/server');
const { Orchestrator } = require('../src/main/pipeline/orchestrator');

(async () => {
  const audio = process.argv[2] || '/tmp/kateb-tone.mp3';
  if (!fs.existsSync(audio)) spawnSync(require('ffmpeg-static'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', audio]);
  // two DISTINCT paths so the per-audio cache doesn't merge them (real files differ)
  const audioA = path.join(os.tmpdir(), 'kateb-par-A.mp3');
  const audioB = path.join(os.tmpdir(), 'kateb-par-B.mp3');
  fs.copyFileSync(audio, audioA); fs.copyFileSync(audio, audioB);

  const srv = await start();
  sel.notebooklm.home = srv.base + '/';
  sel.notebooklm.notebookUrl = (id) => srv.base + '/notebook/' + id;
  sel.gemini.home = srv.base + '/gemini';

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-par-'));
  try { fs.symlinkSync(path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(userData, 'ms-playwright'), 'dir'); } catch (_) {}
  process.env.KATEB_HEADLESS = '1';

  const cfg = require('../src/main/config').defaults();
  cfg.output.dir = path.join(userData, 'out'); cfg.throttleMs = 20; cfg.chunkWords = 200; cfg.concurrency = 2;

  const events = [];
  const orch = new Orchestrator({ userDataDir: userData, config: cfg, emit: (e) => events.push(e) });
  const jobs = [
    { id: 'A', path: audioA, meta: { title: 'فایلِ الف', date: '۱۴۰۵/۰۱/۰۱' } },
    { id: 'B', path: audioB, meta: { title: 'فایلِ ب', date: '۱۴۰۵/۰۱/۰۲' } }
  ];
  await orch.runQueue(jobs);
  await orch.shutdown(); await srv.close();

  const errs = events.filter((e) => e.type === 'file-error');
  if (errs.length) { console.error('errors:', errs.map((e) => e.fileId + ': ' + e.error)); process.exit(1); }
  const doneA = events.find((e) => e.type === 'file-done' && e.fileId === 'A');
  const doneB = events.find((e) => e.type === 'file-done' && e.fileId === 'B');
  assert(doneA && doneB, 'both files should finish');
  for (const p of [...doneA.outputs, ...doneB.outputs]) assert(fs.existsSync(p), 'output exists: ' + p);

  const aDoneIdx = events.findIndex((e) => e.type === 'file-done' && e.fileId === 'A');
  const bStartIdx = events.findIndex((e) => e.type === 'stage' && e.fileId === 'B');
  const overlapped = bStartIdx >= 0 && bStartIdx < aDoneIdx;
  console.log('both files completed:', !!(doneA && doneB));
  console.log('files overlapped (B started before A finished):', overlapped);
  assert(overlapped, 'files should run in parallel (overlap)');
  console.log('\nPARALLEL TEST PASSED ✓');
})().catch((e) => { console.error('PARALLEL FAILED:', e.stack || e); process.exit(1); });
