// gemini.js — drive Gemini's web chat to clean one chunk of transcript: open a fresh chat on
// the chosen model, type the text into div.ql-editor with trusted input (keyboard.insertText —
// survives Persian + newlines, needs no clipboard/focus), click Send, poll the last
// <message-content> until it stops growing, then read it back as markdown.
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
  const need = Math.min(200, Math.floor(message.replace(/\s+/g, '').length * 0.4));
  const edLen = () => page.evaluate((sel) => { const e = document.querySelector(sel); return e ? (e.innerText || '').replace(/\s+/g, '').length : 0; }, S.editorSel).catch(() => 0);

  // (1) TRUSTED focus + insertText — types straight into the editor through the browser's own
  //     input pipeline: no OS clipboard, no window focus. Gemini's Sep-2026 input UI
  //     ("new-input-ui") silently drops the synthetic paste below, so this is now primary.
  try {
    await page.locator(S.editorSel).first().click({ timeout: 8000 });
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    await page.keyboard.insertText(message);
    await page.waitForTimeout(600);
    const got = await edLen();
    if (got >= need) return got;
  } catch (_) {}

  // (2) older editors: synthetic paste event
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

  if (got >= need) return got;

  // (3) fallback: real clipboard (bring the tab to front first so Ctrl+V has clipboard access)
  await page.bringToFront().catch(() => {});
  await page.evaluate(async (text) => { try { await navigator.clipboard.writeText(text); } catch (_) {} }, message).catch(() => {});
  await page.click(S.editorSel).catch(() => {});
  await page.keyboard.press('Control+V');
  await page.waitForTimeout(500);
  return page.evaluate((sel) => { const e = document.querySelector(sel); return e ? (e.innerText || '').replace(/\s+/g, '').length : 0; }, S.editorSel).catch(() => 0);
}

// Make sure the chat runs on the wanted model. Idempotent: a no-op when already selected.
async function ensureModel(page, want) {
  if (!want) return;
  try {
    const picker = page.locator(S.modePickerSel).first();
    await picker.waitFor({ state: 'visible', timeout: 5000 });
    const wantRe = new RegExp('\\b' + want + '\\b', 'i');
    const isFlash = /flash/i.test(want);
    // label looks like "Open mode picker, currently 3.1 Pro" — skip the menu when already on it
    const cur = ((await picker.getAttribute('aria-label')) || '').split(/currently/i)[1] || '';
    if (wantRe.test(cur) && !(isFlash && /lite/i.test(cur))) return;
    await picker.click({ timeout: 6000 });
    await page.waitForTimeout(800);
    // "Pro" must not hit a Flash row; "Flash" means 3.x Flash, not Flash-Lite. Menu rows first —
    // a bare button fallback could otherwise land on an "Upgrade to … Pro" banner.
    const pick = (sel) => {
      const o = page.locator(sel).filter({ hasText: wantRe }).filter({ hasNotText: /upgrade|ارتقا/i });
      return isFlash ? o.filter({ hasNotText: /Lite/i }) : o.filter({ hasNotText: /Flash/i });
    };
    let opt = pick('[role=menuitemradio],[role=menuitem],[role=option]');
    if (!(await opt.count())) opt = pick('button');
    await opt.first().click({ timeout: 6000 });
    await page.waitForTimeout(1000);
  } catch (_) { /* picker missing/changed — keep whatever model is active */ }
}

// Open a brand-new Gemini chat. Every chunk (and every retry of it) gets its own clean chat:
// piling 15+ long chunks and their retries into ONE conversation made Gemini slow and
// confused ("already done") — replies came back near-empty. Only «ادامه بده» stays in-chat.
async function freshChat(page, model = module.exports.model) {
  await page.goto(S.home, { waitUntil: 'domcontentloaded' }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    if (await page.evaluate((sel) => !!document.querySelector(sel), S.editorSel).catch(() => false)) { await ensureModel(page, model); return true; }
  }
  return false;
}

// Send one message and return Gemini's reply rendered back to markdown.
async function sendAndGet(page, message, { fresh = false } = {}) {
  if (fresh) await freshChat(page);
  const landed = await injectMessage(page, message);
  if (!landed || landed < 20) return '';   // text never reached the editor — bail fast, caller retries

  const base = await page.evaluate((sel) => document.querySelectorAll(sel).length, S.responseSel);
  await page.waitForTimeout(1000);
  // TRUSTED click on Send — the new UI ignores synthetic element.click(); Enter as a fallback
  let sent = false;
  try { await page.locator(S.sendSel).first().click({ timeout: 8000 }); sent = true; } catch (_) {}
  if (!sent) await page.keyboard.press('Enter').catch(() => {});

  // wait until a new reply appears, the stop control is gone, and length is stable.
  // Early-bail if nothing starts within ~40s (a failed send shouldn't cost 6.5 minutes).
  let last = 0, stable = 0, started = false, sawStop = false;
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(({ resp, stopRe }) => {
      const rx = new RegExp(stopRe, 'i');
      const stop = [...document.querySelectorAll('button')].filter((b) => rx.test(b.getAttribute('aria-label') || '')).length;
      const r = document.querySelectorAll(resp); const l = r[r.length - 1];
      return { n: r.length, stop, len: l ? l.innerText.length : 0 };
    }, { resp: S.responseSel, stopRe: S.stopRe.source }).catch(() => ({ n: 0, stop: 1, len: 0 }));
    // A visible "Stop response" means Gemini IS working — Pro "thinks" for a while before any
    // text appears, and bailing then (the old 40s rule) returned an empty reply every time.
    if (st.stop > 0) { sawStop = true; started = true; }
    if (st.n > base && st.len > 15) started = true;
    if (st.n > base && st.stop === 0 && (st.len > 15 || (sawStop && st.len > 0))) {
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
    l.querySelectorAll('h1,h2,h3,h4,p,li,pre,blockquote').forEach((b) => {
      // a <p>/<li> nested inside a list item or quote is already in its parent's text —
      // capturing it again printed every bullet twice in the document
      if (b.parentElement && b.parentElement.closest('li,blockquote,pre') && l.contains(b.parentElement.closest('li,blockquote,pre'))) return;
      const t = (b.innerText || '').trim(); if (!t) return;
      const g = b.tagName.toLowerCase();
      if (g === 'h1') out.push('# ' + t);
      else if (g === 'h2') out.push('## ' + t);
      else if (g === 'h3' || g === 'h4') out.push('### ' + t);
      else if (g === 'li') out.push('- ' + t);
      else out.push(t);
    });
    const md = out.join('\n\n');
    const plain = (l.innerText || '').trim();
    // structured pass missed a lot (e.g. a table) -> keep the full plain text instead
    return (md.replace(/\s+/g, '').length < plain.replace(/\s+/g, '').length * 0.6) ? plain : md;
  }, S.responseSel).catch(() => '');
}

module.exports = { ensureGemini, sendAndGet, freshChat, ensureModel, model: 'Pro' };
