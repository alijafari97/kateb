const path = require('path'), os = require('os');
const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.homedir(), '.config', 'کاتب', 'browser-profile'), { headless: false, viewport: { width: 1500, height: 1000 } });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto('https://notebooklm.google.com/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(6000);
  console.log('home url:', p.url());
  const btns = await p.evaluate(() => [...document.querySelectorAll('button,[role=button]')]
    .map(b => ((b.getAttribute('aria-label') || '') + ' | ' + (b.innerText || '')).replace(/\s+/g, ' ').trim().slice(0, 50))
    .filter(t => /create|new|notebook|ایجاد|جدید|\+/i.test(t)).slice(0, 12));
  console.log('create-ish buttons:', JSON.stringify(btns, null, 1));

  // try a TRUSTED click on a create button
  const sels = ['button:has-text("Create new")', 'button:has-text("Create notebook")', 'button[aria-label*="Create" i]', 'button:has-text("New notebook")'];
  let clicked = false;
  for (const s of sels) {
    const loc = p.locator(s).first();
    if (await loc.count().catch(() => 0)) {
      await loc.click({ timeout: 6000 }).then(() => { clicked = true; console.log('trusted-clicked:', s); }).catch((e) => console.log('click fail', s, e.message));
      if (clicked) break;
    }
  }
  for (let i = 0; i < 8; i++) { await p.waitForTimeout(2000); const m = p.url().match(/notebook\/([a-f0-9-]{20,})/i); console.log(`  t+${(i + 1) * 2}s url:`, p.url().slice(0, 70), m ? '-> NBID ' + m[1].slice(0, 8) : ''); if (m) break; }
  await p.waitForTimeout(1000);
  await ctx.close();
})().catch(e => { console.error('diag failed:', e.message); process.exit(1); });
