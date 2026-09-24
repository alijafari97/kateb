// audio.js — bundled ffmpeg. NotebookLM stalls on very long audio, so split anything
// past the threshold into <=maxPart halves. Copy-split is fast; if NLM later chokes on
// a part, reencode() produces a clean mono mp3 that transcribes reliably (field lesson).
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Resolve ffmpeg. Prefer the bundled ffmpeg-static binary (unpacked from asar when packaged).
// But that binary is fetched by a postinstall DOWNLOAD that can fail silently (e.g. on a
// filtered network) — leaving a path to nothing, so every probe/shrink/split quietly no-ops
// and big files get uploaded raw. In that case fall back to an ffmpeg on the system.
function resolveFfmpeg() {
  let p = null;
  try { p = require('ffmpeg-static'); } catch (_) {}
  if (p) {
    p = p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');   // electron-builder unpacks native bins
    if (fs.existsSync(p)) return p;
  }
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const dirs = String(process.env.PATH || '').split(path.delimiter)
    .concat([path.join(home, '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/opt/homebrew/bin']);
  for (const d of dirs) { try { if (d && fs.existsSync(path.join(d, exe))) return path.join(d, exe); } catch (_) {} }
  return p || exe;
}
let ffmpegPath = resolveFfmpeg();

function run(args) {
  return new Promise((resolve) => {
    const ps = spawn(ffmpegPath, args);
    let err = '';
    ps.stderr.on('data', (d) => (err += d.toString()));
    ps.on('close', (code) => resolve({ code, err }));
    ps.on('error', () => resolve({ code: -1, err }));
  });
}

async function probeDurationSec(file) {
  const { err } = await run(['-i', file]);
  const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return 0;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

// Split into N ~equal parts if longer than aboveMinutes; else return [file].
async function splitIfLong(file, { aboveMinutes = 150, maxPartMinutes = 124, workDir }) {
  const dur = await probeDurationSec(file);
  if (!dur || dur <= aboveMinutes * 60) return [file];
  const parts = Math.ceil(dur / (maxPartMinutes * 60));
  const seg = Math.ceil(dur / parts);
  fs.mkdirSync(workDir, { recursive: true });
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const out = [];
  for (let i = 0; i < parts; i++) {
    const p = path.join(workDir, `${base}_part${i + 1}of${parts}.mp3`);
    await run(['-y', '-v', 'error', '-i', file, '-ss', String(i * seg), '-t', String(seg), '-c', 'copy', p]);
    out.push(p);
  }
  return out;
}

// Shrink an over-large file so NotebookLM accepts it: re-encode to mono, low-bitrate
// mp3 (plenty for speech). Returns the original path if already small enough.
async function shrinkForNLM(file, { maxMB = 45, bitrate = '40k', workDir }) {
  let sizeMB = 0;
  try { sizeMB = fs.statSync(file).size / 1048576; } catch (_) { return file; }
  if (sizeMB <= maxMB) return file;
  fs.mkdirSync(workDir, { recursive: true });
  const out = path.join(workDir, path.basename(file).replace(/\.[^.]+$/, '') + '_small.mp3');
  await run(['-y', '-v', 'error', '-i', file, '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', bitrate, out]);
  try { if (fs.statSync(out).size > 0) return out; } catch (_) {}
  return file; // fall back to original if the shrink produced nothing
}

// Clean re-encode (mono) — recovery when a copy-split part stalls in NLM.
async function reencode(file, workDir) {
  fs.mkdirSync(workDir, { recursive: true });
  const out = path.join(workDir, path.basename(file).replace(/\.[^.]+$/, '') + '_clean.mp3');
  await run(['-y', '-v', 'error', '-i', file, '-ac', '1', '-ar', '22050', '-c:a', 'libmp3lame', '-b:a', '32k', out]);
  return out;
}

module.exports = { probeDurationSec, splitIfLong, reencode, shrinkForNLM, ffmpegPath };
