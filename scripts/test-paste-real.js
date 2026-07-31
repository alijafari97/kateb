// test-paste-real.js — verify the focus-independent paste against REAL Gemini using the
// app's logged-in profile. Sends a tiny message and checks the reply came back.
const path = require('path'), os = require('os');
const { KatebBrowser } = require('../src/main/pipeline/browser');
const { ensureGemini, sendAndGet } = require('../src/main/pipeline/gemini');

(async () => {
  const headless = process.env.KATEB_HEADED !== '1';
  const b = await new KatebBrowser({
    userDataDir: path.join(os.homedir(), '.config', 'Kateb', 'browser-profile'),
    throttleMs: 150, headless, onLog: (m) => console.log('  browser:', m)
  }).launch();
  try {
    const g = await ensureGemini(b);
    console.log('gemini ready (headless=' + headless + ')');
    const msg = 'این یک تستِ کوتاه است. لطفاً این جمله را عیناً و کامل بازگردان و چیزی اضافه نکن: «مارکرِ تست ۹۹۸۸۷ پایان.» ' + 'واژهٔ پرکننده. '.repeat(40);
    const t0 = Date.now();
    const reply = await sendAndGet(g, msg);
    const secs = Math.round((Date.now() - t0) / 1000);
    console.log(`\nreply: ${reply.length} chars in ${secs}s | has marker: ${reply.includes('۹۹۸۸۷')}`);
    console.log('--- reply head ---\n' + reply.slice(0, 300));
  } finally {
    await b.close();
  }
})().catch((e) => { console.error('FAIL:', e.stack || e); process.exit(1); });
