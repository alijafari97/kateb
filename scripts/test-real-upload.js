// test-real-upload.js <audiofile> — run the REAL transcribeFile against live NotebookLM
// using the app's logged-in profile: create → upload (tab stays open until the bytes land)
// → wait for the transcript. Prints the head of the transcript so you can eyeball it.
// NOTE: this creates a real notebook in your account; delete it yourself when done.
const path = require('path'), os = require('os');
// use the default browser cache (~/.cache/ms-playwright) where chromium is installed
const { KatebBrowser } = require('../src/main/pipeline/browser');
const nlm = require('../src/main/pipeline/notebooklm');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/test-real-upload.js <audiofile>'); process.exit(1); }
  const b = await new KatebBrowser({
    userDataDir: path.join(os.homedir(), '.config', 'کاتب', 'browser-profile'),
    throttleMs: 200, headless: false, onLog: (m) => console.log('  ·', m)
  }).launch();
  try {
    await b.ensureNotebookLM();
    const t0 = Date.now();
    const transcript = await nlm.transcribeFile(b, file, { onLog: (m) => console.log('  ·', m) });
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`\n✅ TRANSCRIPT (${transcript.length} chars, ${secs}s):\n`);
    console.log(transcript.slice(0, 600).replace(/\s+/g, ' '));
    console.log(transcript.length > 600 ? '\n…(truncated)…' : '');
  } finally {
    await b.close();
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
