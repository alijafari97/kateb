// resume.js — prove a re-run of the SAME file resumes from disk instead of starting over:
// no new NotebookLM notebook, no re-clean — it reuses the cached transcript + cleaned text
// (this is what «ادامه بده» must do, per the bug report).
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const { spawnSync } = require('child_process');
const sel = require('../src/main/selectors');
const { start } = require('./fixtures/server');
const { Orchestrator } = require('../src/main/pipeline/orchestrator');
const nlm = require('../src/main/pipeline/notebooklm');

(async () => {
  const audio = process.argv[2] || '/tmp/kateb-tone.mp3';
  if (!fs.existsSync(audio)) spawnSync(require('ffmpeg-static'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'libmp3lame', audio]);

  const srv = await start();
  sel.notebooklm.home = srv.base + '/';
  sel.notebooklm.notebookUrl = (id) => srv.base + '/notebook/' + id;
  sel.gemini.home = srv.base + '/gemini';

  // spy on the expensive NLM step (namespace call in the orchestrator, so this is seen)
  let transcribeCalls = 0;
  const origTranscribe = nlm.transcribeFile;
  nlm.transcribeFile = (...a) => { transcribeCalls++; return origTranscribe(...a); };

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-resume-'));
  try { fs.symlinkSync(path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(userData, 'ms-playwright'), 'dir'); } catch (_) {}
  process.env.KATEB_HEADLESS = '1';

  const cfg = require('../src/main/config').defaults();
  cfg.output.dir = path.join(userData, 'out'); cfg.throttleMs = 20; cfg.chunkWords = 200; cfg.concurrency = 1;

  let events = [];
  const orch = new Orchestrator({ userDataDir: userData, config: cfg, emit: (e) => events.push(e) });
  const job = { id: 'f1', path: audio, meta: { title: 'سندِ رزومه', date: '۱۴۰۵/۰۱/۰۱' } };

  // ---- first run: transcribes + cleans, and caches both to disk ----
  await orch.runJob(job);
  assert(transcribeCalls >= 1, 'first run must actually transcribe');
  assert(events.find((e) => e.type === 'file-done'), 'first run finishes');
  const jobWork = orch.cacheDirFor(job);   // keyed by audio identity, not the UI id
  assert(fs.existsSync(path.join(jobWork, 'transcript-0.txt')), 'transcript cached to disk');
  assert(fs.existsSync(path.join(jobWork, 'cleaned.json')), 'cleaned text cached to disk');

  // ---- second run (the «ادامه بده» retry): must reuse the cache, build no new notebook ----
  transcribeCalls = 0; events = [];
  await orch.runJob(job);
  await orch.shutdown().catch(() => {});
  await srv.close();

  assert.strictEqual(transcribeCalls, 0, 'RESUME: re-run must NOT create a new notebook / re-transcribe');
  assert(events.some((e) => e.type === 'log' && /از متنِ تمیزِ قبلی/.test(e.msg || '')), 'RESUME: clean reused from cache');
  assert(events.some((e) => e.type === 'log' && /از قبل رونویسی شده/.test(e.msg || '')), 'RESUME: transcript reused from cache');
  const done = events.find((e) => e.type === 'file-done');
  assert(done && done.outputs.every((p) => fs.existsSync(p)), 'RESUME: still produces the outputs');

  console.log('run1 transcribed+cached ✓   run2 reused cache, 0 new notebooks ✓   outputs rebuilt ✓');
  console.log('\nRESUME TEST PASSED ✓');
})().catch((e) => { console.error('RESUME FAILED:', e.stack || e); process.exit(1); });
