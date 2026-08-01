// orchestrator.js — the engine. Runs each audio file through the full pipeline and
// emits progress the UI renders as a stepper. One persistent browser drives both NLM
// and Gemini (same Google login). Errors are per-file: one bad file never sinks the queue.
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { KatebBrowser } = require('./browser');
const { ensureChromium } = require('./provision');
const nlm = require('./notebooklm');
const { ensureGemini } = require('./gemini');
const { cleanAllChunks } = require('./verify');
const audio = require('./audio');
const { chunkTranscript } = require('./chunk');
const { buildOutputs } = require('./output');

const STAGES = ['prepare', 'transcribe', 'clean', 'build'];

// A dead/closed/crashed browser or context (as opposed to a normal page-level failure).
function isBrowserDeadError(e) {
  const m = String(e && e.message || e);
  return /has been closed|Target page, context or browser|Target\.createTarget|browserContext\.\w+:|Target closed|browser has (?:been )?(?:closed|disconnected)|crashed|Connection closed|WebSocket/i.test(m);
}

class Orchestrator {
  constructor({ userDataDir, config, emit }) {
    this.appData = userDataDir;
    this.userDataDir = path.join(userDataDir, 'browser-profile'); // persistent Google login
    this.config = config;
    this.emit = emit || (() => {});
    this.browser = null;
    this.gemini = null;
    this.geminiLock = Promise.resolve(); // serialize Gemini use (shared clipboard)
    this.browserReady = null;            // ensureBrowser runs once even under concurrency
    this.running = 0;                    // active job count (for safe browser reset)
    this.launchedHeadless = null;        // display mode the live browser was launched with
    this.workRoot = path.join(userDataDir, 'work');
    fs.mkdirSync(this.workRoot, { recursive: true });
  }

  // Run fn with exclusive access to the Gemini tab (clipboard paste can't overlap).
  async withGemini(fn) {
    const prev = this.geminiLock;
    let release;
    this.geminiLock = new Promise((r) => { release = r; });
    await prev.catch(() => {});
    try {
      if (!this.gemini || this.gemini.isClosed()) this.gemini = await ensureGemini(this.browser);
      return await fn(this.gemini);
    } finally { release(); }
  }

  log(fileId, msg) { this.emit({ type: 'log', fileId, msg }); }
  stage(fileId, stage, status, detail) { this.emit({ type: 'stage', fileId, stage, status, detail }); }

  async ensureBrowser(opts) {
    if (!this.browserReady) this.browserReady = this._launchBrowser(opts);
    return this.browserReady;
  }

  // Login/challenge needs a visible window no matter the background setting. If a hidden
  // browser is already up, drop it and relaunch visible (login persists, so no re-login).
  async ensureBrowserHeaded() {
    if (this.browser && this.launchedHeadless === false) return this.browserReady;
    if (this.browser) await this.resetBrowser();
    return this.ensureBrowser({ headed: true });
  }

  async _launchBrowser(opts = {}) {
    const headless = opts.headed ? false : !this.config.showBrowser;
    this.emit({ type: 'browser', status: 'launching' });
    await ensureChromium(this.appData, { onProgress: (p) => this.emit({ type: 'log', msg: p.msg }) });
    this.browser = await new KatebBrowser({
      userDataDir: this.userDataDir,
      throttleMs: this.config.throttleMs,
      headless,                             // visible for login; background for runs when chosen
      onChallenge: (c) => this.emit({ type: 'challenge', reason: c.reason }),
      onLog: (m) => this.emit({ type: 'log', msg: m })
    }).launch();
    this.launchedHeadless = headless;
    // Verifying NotebookLM at launch is best-effort: a run whose transcripts are already
    // cached only needs Gemini, so a NLM hiccup (e.g. headless) mustn't sink the launch —
    // if transcription IS needed, transcribeFile surfaces the real error per-file.
    try { await this.browser.ensureNotebookLM(); }
    catch (e) { this.emit({ type: 'log', msg: 'NotebookLM اکنون تأیید نشد — اگر رونویسی از قبل آماده باشد مهم نیست.' }); }
    this.gemini = await ensureGemini(this.browser);
    this.emit({ type: 'browser', status: 'ready' });
  }

  // Before a fresh run: if the toggle was flipped while the browser was busy, its
  // visibility no longer matches the setting — drop it (idle now) so it relaunches right.
  async syncDisplayMode() {
    if (this.running > 0 || !this.browser) return;
    if (this.launchedHeadless !== !this.config.showBrowser) await this.resetBrowser();
  }

  titleFor(meta) {
    const t = String(this.config.titleTemplate)
      .replace('{title}', meta.title || '')
      .replace('{name}', meta.title || '')
      .replace('{date}', meta.date || '')
      .replace(/\s+/g, ' ').trim();
    return t || (meta.title || 'سند');
  }

  async transcribeOnePart(partPath, fileId) {
    // one page drives create → upload → wait → extract (never closed mid-upload);
    // on a genuine stall, re-encode to clean mono and retry once with a fresh notebook.
    try {
      return await nlm.transcribeFile(this.browser, partPath, { onLog: (m) => this.log(fileId, m) });
    } catch (e) {
      this.log(fileId, 'رونویسی گیر کرد — با فایلِ تمیزِ مونو دوباره');
      const clean = await audio.reencode(partPath, path.join(this.workRoot, fileId));
      return await nlm.transcribeFile(this.browser, clean, { onLog: (m) => this.log(fileId, m) });
    }
  }

  // Cache dir keyed by the AUDIO itself (path + size), not the UI id — so resume works
  // across app restarts and two different files never collide on a reused id.
  cacheDirFor(job) {
    let sz = 0; try { sz = fs.statSync(job.path).size; } catch (_) {}
    const key = crypto.createHash('md5').update(job.path + ':' + sz).digest('hex').slice(0, 16);
    return path.join(this.workRoot, key);
  }

  async runJob(job) {
    const fileId = job.id;
    const title = this.titleFor(job.meta);
    const jobWork = this.cacheDirFor(job);
    fs.mkdirSync(jobWork, { recursive: true });
    this.running++;
    try {
      let res, tries = 0;
      while (true) {
        try {
          res = await this._pipeline(job, jobWork, title, fileId);
          break;
        } catch (e) {
          // Headless Chromium can occasionally die under concurrent load. Relaunch the
          // browser (login persists) and restart THIS file from scratch, up to twice,
          // instead of failing it. Non-browser errors bubble straight to the catch below.
          if (isBrowserDeadError(e) && tries < 2) {
            tries++;
            this.log(fileId, `مرورگر از کار افتاد — بازنشانی و شروعِ دوبارهٔ این فایل (${tries})`);
            for (const s of STAGES) this.stage(fileId, s, 'wait');
            await this.recoverBrowser();
            continue;
          }
          throw e;
        }
      }
      this.emit({ type: 'file-done', fileId, title, outputs: res.outputs, warnings: res.warnings });
      return { ok: true, outputs: res.outputs, warnings: res.warnings };
    } catch (e) {
      if (process.env.KATEB_DEBUG) console.error(`\n[${fileId}] STACK:`, e && e.stack || e);
      this.emit({ type: 'file-error', fileId, title, error: String(e && e.message || e) });
      return { ok: false, error: String(e && e.message || e) };
    } finally {
      this.running--;
    }
  }

  // The full per-file pipeline. Throws on failure (runJob decides retry vs report).
  async _pipeline(job, jobWork, title, fileId) {
    await this.ensureBrowser();

    // 1) prepare — shrink over-large audio, then split very long audio
    this.stage(fileId, 'prepare', 'now');
    const src = await audio.shrinkForNLM(job.path, { maxMB: this.config.maxAudioMB, workDir: jobWork });
    if (src !== job.path) this.log(fileId, 'صوتِ حجیم برای NotebookLM کوچک شد');
    const parts = await audio.splitIfLong(src, { aboveMinutes: this.config.splitAboveMinutes, workDir: jobWork });
    this.stage(fileId, 'prepare', 'done', parts.length > 1 ? `${parts.length} تکه` : 'آماده');

    // 2) transcribe — each part via NotebookLM (RESUMABLE: a part already transcribed in a
    //    previous attempt is read from disk, so a retry never re-creates a notebook it
    //    already has — it just reuses the text).
    this.stage(fileId, 'transcribe', 'now');
    const pieces = [];
    for (let i = 0; i < parts.length; i++) {
      const pCache = path.join(jobWork, `transcript-${i}.txt`);
      if (fs.existsSync(pCache) && fs.statSync(pCache).size > 100) {
        this.log(fileId, `تکهٔ ${i + 1}/${parts.length} از قبل رونویسی شده — استفادهٔ مجدد`);
        pieces.push(fs.readFileSync(pCache, 'utf8'));
      } else {
        this.log(fileId, `رونویسیِ تکهٔ ${i + 1}/${parts.length}`);
        const t = await this.transcribeOnePart(parts[i], fileId);
        fs.writeFileSync(pCache, t);
        pieces.push(t);
      }
    }
    const transcript = pieces.join('\n\n');
    this.stage(fileId, 'transcribe', 'done', 'تمام');

    // 3) clean — Gemini + anti-summarization gate. Serialized via withGemini (the clipboard
    //    paste can't overlap), so files transcribe in parallel but clean one at a time; a
    //    waiting file shows «در نوبتِ Gemini». RESUMABLE: a completed clean is reused.
    const cCache = path.join(jobWork, 'cleaned.json');
    const promptHash = crypto.createHash('md5').update(String(this.config.cleaningPrompt || '')).digest('hex').slice(0, 12);
    let text, warnings, cached = null;
    try { if (fs.existsSync(cCache)) cached = JSON.parse(fs.readFileSync(cCache, 'utf8')); } catch (_) {}
    if (cached && cached.promptHash === promptHash) {   // reuse only if the prompt is unchanged
      text = cached.text; warnings = cached.warnings || [];
      this.stage(fileId, 'clean', 'now');
      this.log(fileId, 'از متنِ تمیزِ قبلی استفاده شد — دوباره پاک نشد');
    } else {
      const chunks = chunkTranscript(transcript, this.config.chunkWords);
      const doClean = (gp) => cleanAllChunks(gp, this.config.cleaningPrompt, chunks, {
        minRatio: this.config.minLengthRatio,
        onLog: (m) => this.log(fileId, m),
        onProgress: (p) => this.stage(fileId, 'clean', 'now', `تکه ${p.index}/${p.total}`)
      });
      if (this.config.geminiParallel) {
        // each file cleans in its OWN Gemini tab — no queue. Safe now that injection is
        // clipboard-free (synthetic paste), so tabs don't fight over the OS clipboard.
        this.stage(fileId, 'clean', 'now', 'Gemini…');
        const gp = await ensureGemini(this.browser);
        try { ({ text, warnings } = await doClean(gp)); }
        finally { await gp.close().catch(() => {}); }
      } else {
        // serial: one shared Gemini tab, files take turns (safer for Gemini's daily limit)
        this.stage(fileId, 'clean', 'now', 'در نوبتِ Gemini…');
        ({ text, warnings } = await this.withGemini(doClean));
      }
      fs.writeFileSync(cCache, JSON.stringify({ promptHash, text, warnings }));
    }
    this.stage(fileId, 'clean', warnings.length ? 'warn' : 'done', warnings.length ? `${warnings.length} بخش نیاز به بازبینی` : 'کامل ✓');

    // 4) build — local docx/md
    this.stage(fileId, 'build', 'now');
    const outputs = await buildOutputs(text, { title, dir: this.config.output.dir, formats: this.config.output, header: this.config.instituteHeader });
    this.stage(fileId, 'build', 'done');
    return { outputs, warnings };
  }

  // Relaunch after a browser death. Single-flight: concurrent callers share one relaunch.
  recoverBrowser() {
    if (!this._recovering) {
      this._recovering = (async () => {
        try { if (this.browser) await this.browser.close().catch(() => {}); } catch (_) {}
        this.browser = null; this.gemini = null; this.browserReady = null;
        await this.ensureBrowser();   // emits browser:launching / :ready itself
      })().finally(() => { this._recovering = null; });
    }
    return this._recovering;
  }

  // Close the browser so the NEXT run relaunches with the current display mode
  // (visible vs background). No-op while a job is active — we never yank the browser
  // out from under a running file. Returns true if it actually reset.
  async resetBrowser() {
    if (this.running > 0) return false;
    if (this.browser) await this.browser.close().catch(() => {});
    this.browser = null;
    this.gemini = null;
    this.browserReady = null;
    return true;
  }

  async runQueue(jobs) {
    await this.syncDisplayMode();               // honor a display-mode change made since last run
    await this.ensureBrowser().catch(() => {}); // launch once before fanning out
    const queue = jobs.slice();
    const n = Math.max(1, Math.min(this.config.concurrency || 1, jobs.length));
    const worker = async () => { while (queue.length) { const job = queue.shift(); if (job) await this.runJob(job); } };
    await Promise.all(Array.from({ length: n }, () => worker()));
    this.emit({ type: 'queue-done' });
  }

  async shutdown() { if (this.browser) await this.browser.close(); this.browser = null; }
}

module.exports = { Orchestrator, STAGES };
