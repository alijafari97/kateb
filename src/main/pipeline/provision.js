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

// Ensure a usable Chromium exists. Prefer one BUNDLED with the installer (no network);
// fall back to downloading into the user's data dir on first run.
async function ensureChromium(userDataDir, { onProgress = () => {} } = {}) {
  const { chromium } = require('playwright-core');
  const presentAt = (p) => { process.env.PLAYWRIGHT_BROWSERS_PATH = p; try { const e = chromium.executablePath(); return e && fs.existsSync(e); } catch (_) { return false; } };

  // 1) a browser shipped inside the app (resources/ms-playwright) — the reliable path,
  //    especially on restricted networks where the Playwright CDN is slow/blocked.
  const bundled = process.resourcesPath && path.join(process.resourcesPath, 'ms-playwright');
  if (bundled && fs.existsSync(bundled) && presentAt(bundled)) return true;

  // 2) otherwise use / download into the user's data dir
  const dir = path.join(userDataDir, 'ms-playwright');
  fs.mkdirSync(dir, { recursive: true });
  const present = () => presentAt(dir);
  if (present()) return true;

  onProgress({ phase: 'download', msg: 'دریافتِ مرورگر (فقط بارِ اول، کمی طول می‌کشد)…' });
  const logFile = path.join(userDataDir, 'logs', 'chromium-install.log');
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); } catch (_) {}

  const attempt = (n) => new Promise((resolve, reject) => {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: dir };
    const ps = spawn(process.execPath, [cliPath(), 'install', 'chromium'], { env });
    let out = '';
    const cap = (d) => { const s = d.toString(); out += s; const line = s.trim().split('\n').filter(Boolean).pop(); if (line) onProgress({ phase: 'download', msg: line }); };
    ps.stdout.on('data', cap);
    ps.stderr.on('data', cap);
    ps.on('close', (c) => {
      try { fs.appendFileSync(logFile, `\n==== attempt ${n} (exit ${c}) ====\ncli: ${cliPath()}\ndest: ${dir}\n${out}\n`); } catch (_) {}
      if (c === 0 || present()) return resolve();
      const tail = out.trim().split('\n').filter(Boolean).slice(-4).join(' | ') || 'خروجی‌ای تولید نشد';
      reject(new Error(`دریافتِ مرورگر ناموفق شد (کد ${c}). علت: ${tail}\nگزارشِ کامل: ${logFile}`));
    });
    ps.on('error', (e) => reject(new Error('اجرای دریافت‌کننده ناموفق بود: ' + e.message)));
  });

  // one retry — most first-run failures are a transient network/CDN hiccup
  try {
    await attempt(1);
  } catch (e1) {
    onProgress({ phase: 'download', msg: 'دریافت ناموفق بود؛ تلاشِ دوباره…' });
    try { await attempt(2); }
    catch (e2) { throw new Error(String(e2.message || e2) + '\n(اگر دوباره شد: اینترنت/فیلترشکن را بررسی کن — مرورگر از سرورِ Playwright دانلود می‌شود.)'); }
  }
  return true;
}

module.exports = { ensureChromium, cliPath };
