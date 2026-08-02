// main.js — Electron main process: window, settings, folder picker, and the bridge
// that forwards pipeline events to the UI.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { Orchestrator } = require('./pipeline/orchestrator');

// Stable ASCII data-dir name across dev/packaged and all OSes (Persian folder names
// can break on Windows). Login profile lives under <userData>/browser-profile.
app.setName('Kateb');

let win = null;
let orchestrator = null;
let logStream = null;

function initLog(userData) {
  try {
    const dir = path.join(userData, 'logs');
    fs.mkdirSync(dir, { recursive: true });
    logStream = fs.createWriteStream(path.join(dir, 'kateb.log'), { flags: 'a' });
    logStream.write(`\n==== session ${new Date().toISOString()} ====\n`);
  } catch (_) {}
}
function logEvent(evt) { try { if (logStream) logStream.write(`${new Date().toISOString()} ${JSON.stringify(evt)}\n`); } catch (_) {} }

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#ECE3D2',
    title: 'کاتب',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function emitToUI(evt) { logEvent(evt); if (win && !win.isDestroyed()) win.webContents.send('pipeline:event', evt); }

function getOrchestrator() {
  if (!orchestrator) {
    orchestrator = new Orchestrator({
      userDataDir: app.getPath('userData'),
      config: config.load(),
      emit: emitToUI
    });
  } else {
    orchestrator.config = config.load(); // pick up latest settings
  }
  return orchestrator;
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  // Prefer a Chromium BUNDLED with the installer (resources/ms-playwright) — no first-run
  // download. Fall back to the user's data dir (where provision.js downloads it) otherwise.
  const bundled = process.resourcesPath ? path.join(process.resourcesPath, 'ms-playwright') : null;
  process.env.PLAYWRIGHT_BROWSERS_PATH = (bundled && fs.existsSync(bundled)) ? bundled : path.join(userData, 'ms-playwright');
  config.init(userData);
  initLog(userData);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => {
  if (orchestrator) await orchestrator.shutdown().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC ----
ipcMain.handle('settings:get', () => config.load());
ipcMain.handle('settings:save', (_e, patch) => config.save(patch));
ipcMain.handle('settings:defaults', () => config.defaults());

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:pickAudio', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'صوت', extensions: ['mp3', 'm4a', 'wav', 'aac', 'ogg', 'mp4'] }]
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('shell:openPath', (_e, p) => shell.openPath(p));
ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));

ipcMain.handle('browser:warmup', async () => {
  // login button: always open a VISIBLE browser so the user can sign in, even if runs default to background
  try { await getOrchestrator().ensureBrowserHeaded(); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});

// Called when the "show browser" toggle changes: drop the current (idle) browser so the
// next run relaunches visible/hidden per the new setting. No-op if nothing is running yet
// or a job is mid-flight (then it just applies on the following run).
ipcMain.handle('browser:reset', async () => {
  if (!orchestrator) return { ok: true, reset: false };
  orchestrator.config = config.load();
  const reset = await orchestrator.resetBrowser();
  return { ok: true, reset };
});

ipcMain.handle('jobs:start', async (_e, jobs) => {
  const orch = getOrchestrator();
  // don't await the whole queue — let it stream events; report acceptance now
  orch.runQueue(jobs).catch((err) => emitToUI({ type: 'fatal', error: String(err && err.message || err) }));
  return { started: true, count: jobs.length };
});

// Re-run a single file from scratch (after an error) without restarting the app.
ipcMain.handle('jobs:retry', async (_e, job) => {
  const orch = getOrchestrator();
  orch.runJob(job).catch((err) => emitToUI({ type: 'file-error', fileId: job.id, error: String(err && err.message || err) }));
  return { started: true };
});
