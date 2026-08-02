// provision.js — the first-run Chromium provisioner must work. The Windows first-run
// crashed because require.resolve('playwright-core/cli.js') throws (exports map hides it).
// This test exercises the exact path: fresh browsers dir -> ensureChromium downloads it.
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const { ensureChromium, cliPath } = require('../src/main/pipeline/provision');

(async () => {
  // 1) the exact thing that failed on Windows: cliPath must resolve to a real file
  const cp = cliPath();
  assert(fs.existsSync(cp), 'cliPath() must point to an existing cli.js: ' + cp);
  console.log('cliPath ok ->', cp.split(/[\\/]/).slice(-2).join('/'));

  // 2) full flow: provision into a FRESH dir (no Chromium yet -> actually downloads)
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'kateb-prov-'));
  let sawProgress = false;
  const t0 = Date.now();
  await ensureChromium(fresh, { onProgress: () => { if (!sawProgress) { sawProgress = true; process.stdout.write('downloading chromium'); } process.stdout.write('.'); } });
  process.stdout.write('\n');

  const base = path.join(fresh, 'ms-playwright');
  const chromiumDirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /chromium/i.test(d)) : [];
  assert(chromiumDirs.length > 0, 'a chromium-* browser dir must be created under ' + base);

  console.log(`provisioned in ${Math.round((Date.now() - t0) / 1000)}s ->`, chromiumDirs.join(', '));
  console.log('\nPROVISION TEST PASSED ✓');
})().catch((e) => { console.error('PROVISION FAILED:', e.stack || e); process.exit(1); });
