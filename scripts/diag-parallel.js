// diag-parallel.js — reproduce the concurrency crash: two "files" each do transcribeFile
// then a mutex-guarded Gemini clean, exactly like runJob, with timestamped logging.
const os = require('os'), path = require('path'), fs = require('fs');
const sel = require('../src/main/selectors');
const { start } = require('../test/fixtures/server');
const { KatebBrowser } = require('../src/main/pipeline/browser');
const nlm = require('../src/main/pipeline/notebooklm');
const { ensureGemini } = require('../src/main/pipeline/gemini');
const { cleanAllChunks } = require('../src/main/pipeline/verify');
const { chunkTranscript } = require('../src/main/pipeline/chunk');

const t0 = Date.now();
const log = (m) => console.log(`+${((Date.now() - t0) / 1000).toFixed(1)}s  ${m}`);

(async () => {
  const srv = await start();
  sel.notebooklm.home = srv.base + '/';
  sel.notebooklm.notebookUrl = (id) => srv.base + '/notebook/' + id;
  sel.gemini.home = srv.base + '/gemini';

  const dummy = path.join(os.tmpdir(), 'kateb-diag.mp3');
  fs.writeFileSync(dummy, Buffer.from('ID3 diag'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-diag-'));
  try { fs.symlinkSync(path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(userData, 'ms-playwright'), 'dir'); } catch (_) {}
  process.env.KATEB_HEADLESS = '1';

  const headless = process.env.KATEB_HEADED !== '1';
  log('headless=' + headless);
  const b = await new KatebBrowser({ userDataDir: userData, throttleMs: 20, headless }).launch();
  await b.ensureNotebookLM();
  let gemini = await ensureGemini(b);
  log('browser+gemini ready');

  // gemini mutex, mirroring the orchestrator
  let lock = Promise.resolve();
  const withGemini = async (fn) => {
    const prev = lock; let release; lock = new Promise((r) => (release = r));
    await prev.catch(() => {});
    try { if (!gemini || gemini.isClosed()) gemini = await ensureGemini(b); return await fn(gemini); }
    finally { release(); }
  };

  const runFile = async (tag) => {
    log(`[${tag}] transcribe start`);
    const transcript = await nlm.transcribeFile(b, dummy, { maxWaitMs: 60000, onLog: () => {} });
    log(`[${tag}] transcribe done (${transcript.length}) -> clean start`);
    const chunks = chunkTranscript(transcript, 200);
    const { text } = await withGemini((gp) => cleanAllChunks(gp, 'prompt', chunks, { minRatio: 0.85, onLog: () => {} }));
    log(`[${tag}] clean done (${text.length})`);
    return text;
  };

  try {
    if (process.env.KATEB_SERIAL === '1') { await runFile('A'); await runFile('B'); }
    else await Promise.all([runFile('A'), runFile('B')]);
    log('BOTH DONE OK');
  } catch (e) {
    log('CRASH: ' + (e.stack || e));
  } finally {
    await b.close().catch(() => {});
    await srv.close();
  }
})().catch((e) => { console.error('DIAG CRASH:', e.stack || e); process.exit(1); });
