const { chromium } = require('playwright-core');
const path = require('path'), os = require('os');
const sel = require('../src/main/selectors').gemini;
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.homedir(), '.config', 'کاتب', 'browser-profile'), { headless: false, viewport: { width: 1400, height: 900 } });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  const editors = await p.evaluate((s) => document.querySelectorAll(s).length, sel.editorSel);
  console.log('ql-editor count:', editors);

  const msg = 'PROMPT_START پرامپتِ تست: متنِ زیر را تمیز کن.\n---\n' + 'کلمهٔ تستی شماره. '.repeat(90) + ' PROMPT_END';
  console.log('message length:', msg.length);
  const b64 = Buffer.from(msg, 'utf8').toString('base64');
  await p.bringToFront().catch(() => {});

  const readEditor = () => p.evaluate((s) => { const e = document.querySelector(s); const x = e.innerText || ''; return { len: x.length, hasStart: x.includes('PROMPT_START'), hasEnd: x.includes('PROMPT_END') }; }, sel.editorSel);
  const clearEditor = () => p.evaluate((s) => { const e = document.querySelector(s); e.focus(); const sc = window.getSelection(); const r = document.createRange(); r.selectNodeContents(e); sc.removeAllRanges(); sc.addRange(r); document.execCommand('delete'); }, sel.editorSel);

  // --- approach A: synthetic paste event (Quill handles paste) ---
  await clearEditor();
  await p.evaluate(({ s, data }) => {
    const t = new TextDecoder('utf-8').decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    const e = document.querySelector(s); e.focus();
    const dt = new DataTransfer(); dt.setData('text/plain', t);
    e.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { s: sel.editorSel, data: b64 });
  await p.waitForTimeout(1200);
  console.log('A) synthetic paste :', JSON.stringify(await readEditor()), '(expected ~' + msg.length + ')');

  // --- approach B: line-by-line insertText + insertParagraph ---
  await clearEditor();
  await p.evaluate(({ s, data }) => {
    const t = new TextDecoder('utf-8').decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
    const e = document.querySelector(s); e.focus();
    const lines = t.split('\n');
    for (let i = 0; i < lines.length; i++) { if (i) document.execCommand('insertParagraph'); if (lines[i]) document.execCommand('insertText', false, lines[i]); }
  }, { s: sel.editorSel, data: b64 });
  await p.waitForTimeout(1200);
  console.log('B) line-by-line    :', JSON.stringify(await readEditor()), '(expected ~' + msg.length + ')');

  await p.waitForTimeout(1500);
  await ctx.close();
})().catch((e) => { console.error('failed:', e.message); process.exit(1); });
