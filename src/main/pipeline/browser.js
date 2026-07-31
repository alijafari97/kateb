// browser.js — one persistent, headed Chromium that drives NotebookLM & Gemini as a
// human would. The window stays out of the way and is only surfaced for Google login
// or a "verify it's you" challenge (design: risk #1). Login persists via userDataDir.
const { chromium } = require('playwright-core');
const S = require('../selectors');

class KatebBrowser {
  constructor({ userDataDir, throttleMs = 800, onChallenge = () => {}, onLog = () => {}, headless } = {}) {
    this.userDataDir = userDataDir;
    this.throttleMs = throttleMs;
    this.onChallenge = onChallenge;   // called when the human must act
    this.onLog = onLog;
    // Headed in production so the user can log in; headless only for automated tests.
    this.headless = headless !== undefined ? headless : process.env.KATEB_HEADLESS === '1';
    this.ctx = null;
  }

  async launch() {
    this.ctx = await chromium.launchPersistentContext(this.userDataDir, {
      headless: this.headless,
      viewport: S.notebooklm.minViewport,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        // stability under sustained concurrent load in headless (background) mode
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=CalculateNativeWinOcclusion',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows'
      ]
    });
    this.ctx.setDefaultTimeout(45000);
    // Track liveness: headless Chromium can occasionally die under sustained concurrent
    // load; the orchestrator watches this to relaunch and retry rather than hang.
    this.closed = false;
    this.ctx.on('close', () => { this.closed = true; });
    // Gemini's Quill editor only accepts large text via a real paste (see gemini.js).
    await this.ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    this.main = this.ctx.pages()[0] || await this.ctx.newPage();
    return this;
  }

  page() { return this.main; }
  async throttle() { await this.main.waitForTimeout(this.throttleMs); }

  async newPage(url) {
    const pg = await this.ctx.newPage();
    await pg.setViewportSize(S.notebooklm.minViewport);
    if (url) await pg.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    return pg;
  }

  // Close every stray page except `keep` — keeps Chrome's target budget free
  // (learned the hard way: too many tabs and new-tab creation starts failing).
  async cleanupTabs(keep) {
    for (const pg of this.ctx.pages()) {
      if (pg !== keep) { try { await pg.close(); } catch (_) {} }
    }
  }

  async challengeShown(page) {
    const head = await page
      .evaluate(() => (document.body ? document.body.innerText.slice(0, 500) : ''))
      .catch(() => '');
    return S.google.challengeRe.test(head);
  }

  // Bring the automation window to the front so the user can log in / pass a challenge,
  // then wait until the target page is usable again. `readyFn` returns true when good.
  async waitForHuman(page, readyFn, reason) {
    this.onChallenge({ reason });
    if (this.headless) {
      // no window to interact with in background mode — tell the user how to log in
      throw new Error('برای ورود به گوگل، در تنظیمات «نمایشِ مرورگر» را روشن کن، یک‌بار وارد شو، بعد خاموشش کن.');
    }
    try { await page.bringToFront(); } catch (_) {}
    const deadline = Date.now() + 10 * 60 * 1000; // up to 10 min for the human
    while (Date.now() < deadline) {
      if (await readyFn(page).catch(() => false)) return true;
      await page.waitForTimeout(2500);
    }
    throw new Error('timeout waiting for user to sign in / verify');
  }

  // Make sure the NotebookLM app is reachable and signed in. Resolves when the
  // "Create new notebook" button is present.
  async ensureNotebookLM() {
    const p = this.main;
    await p.goto(S.notebooklm.home, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForTimeout(3000);
    const ready = async (pg) => {
      if (await this.challengeShown(pg)) return false;
      return pg.evaluate((re) => {
        const rx = new RegExp(re, 'i');
        return [...document.querySelectorAll('button,[role=button]')].some(
          (e) => rx.test((e.getAttribute('aria-label') || '') + (e.innerText || ''))
        );
      }, S.notebooklm.createRe.source).catch(() => false);
    };
    if (await ready(p)) return true;
    if (await this.challengeShown(p)) {
      await this.waitForHuman(p, ready, 'ورود به گوگل برای NotebookLM لازم است');
      return true;
    }
    // not challenged, just slow — give it a moment / one reload
    await p.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await p.waitForTimeout(4000);
    if (await ready(p)) return true;
    await this.waitForHuman(p, ready, 'ورود به گوگل برای NotebookLM لازم است');
    return true;
  }

  isAlive() { return !!this.ctx && !this.closed; }
  async close() { try { await this.ctx.close(); } catch (_) {} }
}

module.exports = { KatebBrowser };
