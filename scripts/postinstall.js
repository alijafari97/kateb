// postinstall.js — best-effort: pre-fetch Playwright's Chromium for development so
// `npm start` works out of the box. Never fails the install (the packaged app also
// downloads on first run via provision.js).
const { spawnSync } = require('child_process');
try {
  const cli = require.resolve('playwright-core/cli.js');
  spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
} catch (e) {
  console.log('[kateb] chromium pre-download skipped:', e.message);
}
process.exit(0);
