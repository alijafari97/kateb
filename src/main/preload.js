// preload.js — the only bridge between the sandboxed UI and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('kateb', {
  // Electron 32+: the supported way to get an absolute path from a dropped File.
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (_) { return file && file.path || ''; } },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  defaultSettings: () => ipcRenderer.invoke('settings:defaults'),
  warmup: () => ipcRenderer.invoke('browser:warmup'),
  resetBrowser: () => ipcRenderer.invoke('browser:reset'),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  pickAudio: () => ipcRenderer.invoke('dialog:pickAudio'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  startJobs: (jobs) => ipcRenderer.invoke('jobs:start', jobs),
  retryJob: (job) => ipcRenderer.invoke('jobs:retry', job),
  onEvent: (cb) => {
    const h = (_e, evt) => cb(evt);
    ipcRenderer.on('pipeline:event', h);
    return () => ipcRenderer.removeListener('pipeline:event', h);
  }
});
