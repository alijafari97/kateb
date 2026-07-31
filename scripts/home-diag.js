const path = require('path'), os = require('os');
const { chromium } = require('playwright-core');
(async () => {
  const ctx = await chromium.launchPersistentContext(path.join(os.homedir(), '.config', 'کاتب', 'browser-profile'), { headless: false, viewport: { width: 1500, height: 1000 } });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto('https://notebooklm.google.com/', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(7000);
  const info = await p.evaluate(() => {
    const btn = document.querySelector('button[aria-label*="Create" i], button.create-new-button');
    const bt = document.body.innerText;
    const limitLine = bt.split('\n').find(l => /limit|maximum|reached|upgrade|delete|حداکثر|سقف|محدود|Pro|100/i.test(l)) || '';
    const cards = document.querySelectorAll('[class*="notebook" i][class*="card" i], project-button, [class*="project-button" i], mat-card').length;
    return {
      url: location.href,
      createDisabled: btn ? btn.disabled : 'no-button',
      createLabel: btn ? (btn.getAttribute('aria-label') || btn.innerText).slice(0, 40) : '',
      notebookCardCount: cards,
      limitLine: limitLine.slice(0, 140),
      bodyHead: bt.replace(/\s+/g, ' ').slice(0, 200)
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await ctx.close();
})().catch(e => { console.error('failed:', e.message); process.exit(1); });
