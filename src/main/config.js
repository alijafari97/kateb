// config.js — tiny JSON settings store in Electron's userData dir. No extra deps.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { DEFAULT_PROMPT } = require('./pipeline/prompt');

function defaults() {
  const home = os.homedir();
  return {
    cleaningPrompt: DEFAULT_PROMPT,
    output: {
      docx: true,
      md: true,
      dir: path.join(home, 'Documents', 'مجالس')
    },
    // NLM stalls on very long audio; split above this many minutes.
    splitAboveMinutes: 150,
    // Shrink (mono, low-bitrate) audio larger than this many MB before uploading to NLM.
    maxAudioMB: 45,
    // Gemini chunking target (words) — small enough to stay complete.
    chunkWords: 2200,
    // Anti-summarization gate: below this length-ratio => treat as summarized.
    minLengthRatio: 0.85,
    // Title template. {title} is the user's name for the file, {date} is optional.
    titleTemplate: '{title} {date}',
    // Slow the automation down a touch to avoid Google's anti-bot.
    throttleMs: 800,
    instituteHeader: '',
    // Run the automation browser visibly. Off = background (headless) so you can keep
    // working; turn on once for the first Google login, then turn it back off.
    showBrowser: false,
    // How many files to process at the same time.
    concurrency: 2
  };
}

let cfgPath = null;
function init(userDataDir) {
  cfgPath = path.join(userDataDir, 'settings.json');
}

function load() {
  const base = defaults();
  try {
    if (cfgPath && fs.existsSync(cfgPath)) {
      const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return deepMerge(base, saved);
    }
  } catch (_) { /* fall back to defaults */ }
  return base;
}

function save(patch) {
  const merged = deepMerge(load(), patch || {});
  if (cfgPath) fs.writeFileSync(cfgPath, JSON.stringify(merged, null, 2), 'utf8');
  return merged;
}

function deepMerge(a, b) {
  const out = Array.isArray(a) ? a.slice() : { ...a };
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], b[k]);
    } else {
      out[k] = b[k];
    }
  }
  return out;
}

module.exports = { init, load, save, defaults };
