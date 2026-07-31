// integration.js — runs the REAL browser automation (headless) against local fixtures
// that mimic NotebookLM & Gemini. No Google account needed. Exercises the create ->
// upload -> extract flow and, crucially, the anti-summarization recovery loop.
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const sel = require('../src/main/selectors');
const { start, TRANSCRIPT_MARKER } = require('./fixtures/server');
const { KatebBrowser } = require('../src/main/pipeline/browser');
const nlm = require('../src/main/pipeline/notebooklm');
const { ensureGemini } = require('../src/main/pipeline/gemini');
const { cleanChunkVerified } = require('../src/main/pipeline/verify');
const { DEFAULT_PROMPT } = require('../src/main/pipeline/prompt');

(async () => {
  const srv = await start();
  // point the automation at the fixtures (same object the modules read at call time)
  sel.notebooklm.home = srv.base + '/';
  sel.notebooklm.notebookUrl = (id) => srv.base + '/notebook/' + id;
  sel.gemini.home = srv.base + '/gemini';

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-e2e-'));
  const browser = await new KatebBrowser({ userDataDir, throttleMs: 40, headless: true }).launch();

  try {
    // ---- Test 1: NotebookLM  create -> upload -> extract (one page, never closed mid-upload) ----
    const dummy = path.join(os.tmpdir(), 'kateb-dummy.mp3');
    fs.writeFileSync(dummy, Buffer.from('ID3 dummy'));
    const transcript = await nlm.transcribeFile(browser, dummy, { maxWaitMs: 60000, onLog: () => {} });
    assert(transcript.includes(TRANSCRIPT_MARKER), 'transcript contains the marker');
    assert(!/arrow_drop_up|button_magic/.test(transcript), 'NLM UI/summary header stripped');
    console.log(`NLM flow:        create -> upload -> extract   OK  (${transcript.length} chars)`);

    // ---- Test 2: Gemini + anti-summarization recovery ----
    const gpage = await ensureGemini(browser);
    const half1 = 'اینجا نیمهٔ اولِ متن است و کلمهٔ کلیدیِ MARKERALEF دارد. ' + 'کلمه '.repeat(180);
    const half2 = 'اینجا نیمهٔ دومِ متن است و کلمهٔ کلیدیِ MARKERBEH دارد. ' + 'واژه '.repeat(180);
    const chunk = half1 + '\n\n' + half2; // ~370 words -> the mock summarizes the whole
    const res = await cleanChunkVerified(gpage, DEFAULT_PROMPT, chunk, {
      index: 1, total: 1, minRatio: 0.85, onLog: (m) => console.log('   · ' + m)
    });
    assert(!/خلاصه/.test(res.text), 'result is NOT the summary');
    assert(res.text.includes('MARKERALEF') && res.text.includes('MARKERBEH'), 'both halves recovered');
    assert(!res.warning, 'recovered without an unrecoverable warning');
    console.log('Gemini + verify: summary detected -> resplit -> recovered   OK');

    console.log('\nALL INTEGRATION TESTS PASSED ✓');
  } finally {
    await browser.close();
    await srv.close();
  }
})().catch((e) => { console.error('\nINTEGRATION FAILED:', e && e.stack || e); process.exit(1); });
