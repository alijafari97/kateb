// test real clipboard paste into Gemini's Quill editor, then send and read the reply.
const { chromium } = require('playwright-core');
const path = require('path'), os = require('os');
const S = require('../src/main/selectors').gemini;
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.homedir(), '.config', 'کاتب', 'browser-profile'), { headless: false, viewport: { width: 1400, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://gemini.google.com' });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);

  const msg = 'متنِ زیر یک رونویسیِ کوتاهِ گفتاری است. فقط نقطه‌گذاری‌اش کن و لحن را عیناً نگه دار، خلاصه نکن:\n---\nسلام علیکم امروز می خوام درباره صبر صحبت کنم صبر یعنی تحمل در سختی ها و این خیلی مهمه که آدم صبور باشه و از کوره در نره';

  // write to clipboard, focus editor, clear, paste
  await p.evaluate(async (text) => { await navigator.clipboard.writeText(text); }, msg);
  await p.click(S.editorSel).catch(() => {});
  await p.evaluate((s) => { const e = document.querySelector(s); e.focus(); const sc = window.getSelection(); const r = document.createRange(); r.selectNodeContents(e); sc.removeAllRanges(); sc.addRange(r); document.execCommand('delete'); }, S.editorSel);
  await p.keyboard.press('Control+V');
  await p.waitForTimeout(1500);
  const ed = await p.evaluate((s) => (document.querySelector(s).innerText || '').length, S.editorSel);
  console.log('editor length after paste:', ed, '(expected ~' + msg.length + ')');

  // send
  const base = await p.evaluate((s) => document.querySelectorAll(s).length, S.responseSel);
  await p.evaluate((s) => { const b = document.querySelector(s); if (b) b.click(); }, S.sendSel);
  let last = 0, stable = 0;
  for (let i = 0; i < 60; i++) {
    const st = await p.evaluate(({ resp, stopRe }) => { const rx = new RegExp(stopRe, 'i'); const stop = [...document.querySelectorAll('button')].filter((b) => rx.test(b.getAttribute('aria-label') || '')).length; const r = document.querySelectorAll(resp); const l = r[r.length - 1]; return { n: r.length, stop, len: l ? l.innerText.length : 0 }; }, { resp: S.responseSel, stopRe: S.stopRe.source });
    if (st.n > base && st.stop === 0 && st.len > 15) { if (st.len === last) { stable++; if (stable >= 3) break; } else stable = 0; last = st.len; }
    await p.waitForTimeout(2500);
  }
  const reply = await p.evaluate((s) => { const l = [...document.querySelectorAll(s)].pop(); return l ? l.innerText : ''; }, S.responseSel);
  console.log('GEMINI REPLY (first 240):', reply.replace(/\n/g, ' ').slice(0, 240));
  console.log(/صبر/.test(reply) && reply.length > 40 ? '✅ CLIPBOARD PASTE WORKS — Gemini cleaned the text' : '⚠ still not receiving the text');
  await ctx.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
