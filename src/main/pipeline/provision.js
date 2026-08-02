// provision.js — first-run browser provisioning. Instead of bloating the installer,
// the app downloads Playwright's Chromium once into the user's data dir (with a
// progress message). Keeps distribution small and signing simple.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function cliPath() {
  // playwright-core's "exports" map does NOT expose ./cli.js, so require.resolve(
  // 'playwright-core/cli.js') throws ERR_PACKAGE_PATH_NOT_EXPORTED (this is the Windows
  // first-run crash). Resolve the package DIR via its package.json — which IS exported —
  // and join cli.js. (On Linux this path was never hit: Chromium was already present.)
  let p;
  try {
    p = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'cli.js');
  } catch (_) {
    // last resort: relative to the bundled node_modules
    p = path.join(__dirname, '..', '..', '..', 'node_modules', 'playwright-core', 'cli.js');
  }
  // when packaged, the runnable copy lives in app.asar.unpacked (see build.asarUnpack)
  return p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
}

// Ensure a usable Chromium exists; download it if this is the first run.
async function ensureChromium(userDataDir, { onProgress = () => {} } = {}) {
  const dir = path.join(userDataDir, 'ms-playwright');
  process.env.PLAYWRIGHT_BROWSERS_PATH = dir;
  fs.mkdirSync(dir, { recursive: true });

  const { chromium } = require('playwright-core');
  const present = () => { try { const e = chromium.executablePath(); return e && fs.existsSync(e); } catch (_) { return false; } };
  if (present()) return true;

  onProgress({ phase: 'download', msg: 'دریافتِ مرورگر (فقط بارِ اول، کمی طول می‌کشد)…' });
  await new Promise((resolve, reject) => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: dir };
    const ps = spawn(process.execPath, [cliPath(), 'install', 'chromium'], { env });
    let last = '';
    ps.stdout.on('data', (d) => { last = d.toString().trim().split('\n').pop(); onProgress({ phase: 'download', msg: last }); });
    ps.stderr.on('data', (d) => { last = d.toString().trim().split('\n').pop(); });
    ps.on('close', (c) => (c === 0 || present()) ? resolve() : reject(new Error('دریافتِ مرورگر ناموفق بود (' + c + ') ' + last)));
    ps.on('error', reject);
  });
  return true;
}

module.exports = { ensureChromium, cliPath };
