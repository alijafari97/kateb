// gemini.js — drive Gemini's web chat to clean one chunk of transcript. Ported from
// the proven openclaw gemini_batch flow: inject text into div.ql-editor via a
// base64 execCommand('insertText') (survives Persian + newlines), click Send, poll
// the last <message-content> until it stops growing, then read it back as markdown.
const S = require('../selectors').gemini;
const G = require('../selectors').google;

async function ensureGemini(browser) {
  const pg = await browser.newPage(S.home);
  const ready = async (p) => p.evaluate((sel) => !!document.querySelector(sel), S.editorSel).catch(() => false);
  const challenged = async (p) => {
    const head = await p.evaluate(() => (document.body ? document.body.innerText.slice(0, 500) : '')).catch(() => '');
    return new RegExp(G.challengeRe.source, 'i').test(head);
  };
  // Gemini is a heavy app — the editor can take a while to render (esp. headless). Poll
  // patiently before concluding a login is needed, so a slow load isn't mistaken for a
  // sign-in wall. A real challenge is escalated as soon as it's detected.
  for (let i = 0; i < 12; i++) {
    await pg.waitForTimeout(3000);
    if (await ready(pg)) return pg;
    if (await challenged(pg)) { await browser.waitForHuman(pg, ready, 'ورود به گوگل برای Gemini لازم است'); return pg; }
  }
  await pg.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  for (let i = 0; i < 8; i++) { await pg.waitForTimeout(3000); if (await ready(pg)) return pg; }
  await browser.waitForHuman(pg, ready, 'ورود به گوگل برای Gemini لازم است');
  return pg;
}

// Put the message into Gemini's editor WITHOUT the OS clipboard or window focus. The old
// approach (navigator.clipboard.writeText + Ctrl+V) silently pastes NOTHING whenever the
// tab isn't focused — which is exactly what happens in visible mode while the user clicks
// around. A synthetic `paste` event carries the text via DataTransfer straight to Gemini's
// Quill clipboard module, which syncs its model the same as a real paste. Returns the
// resulting editor length so the caller can confirm the text actually landed.
async function injectMessage(page, message) {
  await page.evaluate((sel) => {
    const e = document.querySelector(sel); if (!e) return;
    e.focus();
    const s = window.getSelection(); const r = document.createRange();
    r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r);
    document.execCommand('delete');
  }, S.editorSel).catch(() => {});

  const got = await page.evaluate(({ sel, text }) => {
    const el = document.querySelector(sel); if (!el) return -1;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } catch (e) { return -2; }
    return (el.innerText || '').replace(/\s+/g, '').length;
  }, { sel: S.editorSel, text: message }).catch(() => -3);

  const need = Math.min(200, Math.floor(message.replace(/\s+/g, '').length * 0.4));
  if (got >= need) return got;

  // fallback: real clipboard (bring the tab to front first so Ctrl+V has clipboard access)
  await page.bringToFront().catch(() => {});
  await page.evaluate(async (text) => { try { await navigator.clipboard.writeText(text); } catch (_) {} }, message).catch(() => {});
  await page.click(S.editorSel).catch(() => {});
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(500);
  return page.evaluate((sel) => { const e = document.querySelector(sel); return e ? (e.innerText || '').replace(/\s+/g, '').length : 0; }, S.editorSel).catch(() => 0);
}

// Send one message and return Gemini's reply rendered back to markdown.
async function sendAndGet(page, message) {
  const landed = await injectMessage(page, message);
  if (!landed || landed < 20) return '';   // text never reached the editor — bail fast, caller retries

  const base = await page.evaluate((sel) => document.querySelectorAll(sel).length, S.responseSel);
  await page.waitForTimeout(1000);
  await page.evaluate((sel) => { const b = document.querySelector(sel); if (b) b.click(); }, S.sendSel);
  // Enter is Gemini's other send path — harmless if the click already submitted
  await page.keyboard.press('Enter').catch(() => {});

  // wait until a new reply appears, the stop control is gone, and length is stable.
  // Early-bail if nothing starts within ~40s (a failed send shouldn't cost 6.5 minutes).
  let last = 0, stable = 0, started = false;
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(({ resp, stopRe }) => {
      const rx = new RegExp(stopRe, 'i');
      const stop = [...document.querySelectorAll('button')].filter((b) => rx.test(b.getAttribute('aria-label') || '')).length;
      const r = document.querySelectorAll(resp); const l = r[r.length - 1];
      return { n: r.length, stop, len: l ? l.innerText.length : 0 };
    }, { resp: S.responseSel, stopRe: S.stopRe.source }).catch(() => ({ n: 0, stop: 1, len: 0 }));
    if (st.n > base && (st.stop > 0 || st.len > 15)) started = true;
    if (st.n > base && st.stop === 0 && st.len > 15) {
      if (st.len === last) { stable++; if (stable >= 3) break; } else stable = 0;
      last = st.len;
    }
    if (!started && i >= 13) return '';   // ~40s and no reply began — send didn't take; caller retries
    await page.waitForTimeout(3000);
  }

  // render the last reply back to markdown (h1->#, h2->##, li->-)
  return page.evaluate((resp) => {
    const l = [...document.querySelectorAll(resp)].pop();
    if (!l) return '';
    const out = [];
    l.querySelectorAll('h1,h2,h3,p,li,pre,blockquote').forEach((b) => {
      const t = (b.innerText || '').trim(); if (!t) return;
      const g = b.tagName.toLowerCase();
      if (g === 'h1') out.push('# ' + t);
      else if (g === 'h2') out.push('## ' + t);
      else if (g === 'h3') out.push('### ' + t);
      else if (g === 'li') out.push('- ' + t);
      else out.push(t);
    });
    return out.join('\n\n');
  }, S.responseSel).catch(() => '');
}

module.exports = { ensureGemini, sendAndGet };
