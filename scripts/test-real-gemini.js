const path = require('path'), os = require('os');
const { KatebBrowser } = require('../src/main/pipeline/browser');
const { ensureGemini, sendAndGet } = require('../src/main/pipeline/gemini');
(async () => {
  const b = await new KatebBrowser({ userDataDir: path.join(os.homedir(), '.config', 'کاتب', 'browser-profile'), throttleMs: 200, headless: false }).launch();
  try {
    const gp = await ensureGemini(b);
    const msg = 'متنِ زیر یک رونویسیِ کوتاهِ گفتاری است. فقط نقطه‌گذاری‌اش کن و لحن را عیناً نگه دار، خلاصه نکن:\n---\nسلام علیکم امروز می خوام درباره صبر صحبت کنم صبر یعنی تحمل در سختی ها و این خیلی مهمه که آدم صبور باشه و از کوره در نره';
    const out = await sendAndGet(gp, msg);
    console.log('GEMINI REPLY (first 240):', (out || '').replace(/\n/g, ' ').slice(0, 240));
    console.log('reply length:', (out || '').length);
    console.log(/صبر/.test(out || '') && (out || '').length > 40 ? '✅ REAL GEMINI CLEANED THE TEXT — flow works' : '⚠ unexpected reply');
  } finally { await b.close(); }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
