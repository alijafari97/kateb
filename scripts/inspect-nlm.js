// inspect-nlm.js — open real NotebookLM with the app's logged-in profile, create a
// notebook, and dump the "Add sources" DOM so we can fix the upload selector.
const { chromium } = require('playwright-core');
const path = require('path'), os = require('os');
const PROFILE = path.join(os.homedir(), '.config', 'کاتب', 'browser-profile');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(os.homedir(), '.config', 'کاتب', 'ms-playwright');

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, viewport: { width: 1500, height: 1000 } });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto('https://notebooklm.google.com/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);

  // click "Create new notebook"
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button,[role=button]')].find(e => /Create new notebook|Create notebook|New notebook|ایجاد|نوت‌بوک جدید/i.test((e.getAttribute('aria-label') || '') + (e.innerText || '')));
    if (b) ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(t => b.dispatchEvent(new MouseEvent(t, { bubbles: true, view: window })));
  });
  await p.waitForTimeout(7000);
  console.log('URL after create:', p.url());

  const dump = await p.evaluate(() => {
    const q = (s) => [...document.querySelectorAll(s)];
    const inputs = q('input[type=file]').map(i => ({ accept: i.accept || '', visible: i.offsetParent !== null, id: i.id, cls: (i.className || '').slice(0, 40) }));
    const label = (b) => ((b.getAttribute('aria-label') || '') + ' | ' + (b.innerText || '')).replace(/\s+/g, ' ').trim().slice(0, 55);
    const btns = q('button,[role=button],[role=menuitem]').map(label).filter(t => /upload|source|منبع|بارگذاری|choose|file|drive|audio|آپلود|افزودن|add|انتخاب/i.test(t)).slice(0, 25);
    const dz = q('[class*=drop i],[class*=upload i],[class*=uploader i]').map(e => e.tagName + '.' + (e.className || '').toString().split(' ')[0]).slice(0, 12);
    return { fileInputs: inputs, uploadButtons: [...new Set(btns)], dropzones: [...new Set(dz)], body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 240) };
  });
  console.log('=== NLM ADD-SOURCES DOM ===');
  console.log(JSON.stringify(dump, null, 2));

  // test: does a TRUSTED Playwright click on "Upload files" open the file chooser?
  const fcFired = p.waitForEvent('filechooser', { timeout: 12000 }).then(() => true).catch(() => false);
  const btn = p.locator('button:has-text("Upload files")').first();
  await btn.click({ timeout: 8000 }).catch((e) => console.log('trusted click err:', e.message));
  console.log('=== filechooser fired after trusted click:', await fcFired);
  console.log('=== input[type=file] present now:', await p.evaluate(() => document.querySelectorAll('input[type=file]').length));

  await p.waitForTimeout(1200);
  await ctx.close();
})().catch((e) => { console.error('inspect failed:', e.message); process.exit(1); });
