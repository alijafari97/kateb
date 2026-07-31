// verify.js — the anti-summarization safeguard. In the app Gemini does the cleaning
// with no AI watching, so completeness is enforced here as deterministic code:
//   clean -> 3 checks -> pass? next : (continue | retry | split-and-recurse) -> final gate.
const { buildChunkMessage, buildContinueMessage } = require('./prompt');
const { sendAndGet } = require('./gemini');

// Tell-tale phrases that mean Gemini summarized or bailed instead of cleaning verbatim.
const SUMMARY_RE = /به\s?طور\s?خلاصه|خلاصه‌?ای از|به اختصار|(?:^|\s)و ادامه(?:\s|…|\.)|ادامه دارد|ادامه می‌?یابد|\[\s*متن ادامه دارد\s*\]|\[\s*\.\.\.\s*\]|و الی آخر|and so on|to summari[sz]e|in summary/i;

const norm = (s) => String(s || '').replace(/[#*>`_]|(?:^|\s)-\s/g, ' ').replace(/‌/g, '').replace(/\s+/g, ' ').trim();
const wordsOf = (s) => norm(s).split(' ').filter((w) => w.length > 2);

// The three checks. Returns {ok} or {ok:false, kind:'summary'|'truncated'|'empty', ...}.
function checkCompleteness(input, output, minRatio) {
  const inN = norm(input);
  const outN = norm(output);
  if (!outN || outN.length < 40) return { ok: false, kind: 'empty', reason: 'خروجی خالی', ratio: 0 };
  const ratio = outN.length / Math.max(1, inN.length);

  // ZWNJ-tolerant: «به‌طور خلاصه» often uses a half-space, not a real space.
  const flat = String(output).replace(/‌/g, ' ');
  if (SUMMARY_RE.test(output) || SUMMARY_RE.test(flat)) return { ok: false, kind: 'summary', reason: 'عبارتِ خلاصه‌ساز', ratio };

  if (ratio < minRatio) {
    const tail = wordsOf(input).slice(-10);
    const outSet = new Set(wordsOf(output));
    const present = tail.filter((w) => outSet.has(w)).length;
    return { ok: false, kind: present < 3 ? 'truncated' : 'summary', reason: `طولِ کم (${ratio.toFixed(2)})`, ratio };
  }

  // length is fine, but guard against a clean cut where the tail is simply gone
  const tail = wordsOf(input).slice(-8);
  const outW = wordsOf(output);
  const outTail = new Set(outW.slice(-Math.max(20, Math.ceil(outW.length * 0.4))));
  const present = tail.filter((w) => outTail.has(w)).length;
  if (tail.length >= 6 && present === 0) return { ok: false, kind: 'truncated', reason: 'انتهای متن جا افتاده', ratio };

  return { ok: true, ratio };
}

function stripPreamble(md) {
  let t = String(md || '').trim();
  t = t.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim();
  // drop a leading "here is the cleaned text:" style line
  t = t.replace(/^(?:در اینجا|این هم|متنِ? تمیز(?:‌?شده)?|خب،|بفرمایید)[^\n]{0,60}:\s*\n+/i, '');
  return t.trim();
}
const lastSnippet = (s) => wordsOf(s).slice(-12).join(' ');

function splitInHalf(text) {
  const w = text.split(/\s+/);
  if (w.length < 60) return null; // too small to gain anything
  let cut = Math.floor(w.length / 2);
  // prefer a paragraph boundary near the midpoint
  const mid = Math.floor(text.length / 2);
  const nl = text.indexOf('\n\n', mid - 400);
  if (nl > mid - 800 && nl < mid + 800) {
    return [text.slice(0, nl).trim(), text.slice(nl).trim()];
  }
  return [w.slice(0, cut).join(' '), w.slice(cut).join(' ')];
}

// Clean ONE chunk with the full safeguard loop. Returns {text, warning}.
async function cleanChunkVerified(page, basePrompt, chunkText, opts = {}) {
  const { index = 1, total = 1, hasNlmSummary = false, minRatio = 0.85, onLog = () => {}, depth = 0, insist = false } = opts;
  const msg = buildChunkMessage(basePrompt, chunkText, { index, total, hasNlmSummary, insist });

  let out = stripPreamble(await sendAndGet(page, msg));
  let chk = checkCompleteness(chunkText, out, minRatio);

  // (a) truncated mid-output -> ask Gemini to continue, then stitch
  if (!chk.ok && chk.kind === 'truncated') {
    onLog(`بخش ${index}: وسط قطع شد — «ادامه بده»`);
    const cont = stripPreamble(await sendAndGet(page, buildContinueMessage(lastSnippet(out))));
    if (cont && cont.length > 40) { out = (out + '\n\n' + cont).trim(); chk = checkCompleteness(chunkText, out, minRatio); }
  }

  // (b) retry with a FORCEFUL instruction — the manual trick: tell it verbatim, no summary
  if (!chk.ok && depth === 0) {
    onLog(`بخش ${index}: ناقص (${chk.reason}) — دوباره با تأکید`);
    const out2 = stripPreamble(await sendAndGet(page, buildChunkMessage(basePrompt, chunkText, { index, total, hasNlmSummary, insist: true })));
    const chk2 = checkCompleteness(chunkText, out2, minRatio);
    if (chk2.ok) return { text: out2, warning: null };
    if ((chk2.ratio || 0) > (chk.ratio || 0)) { out = out2; chk = chk2; }
  }

  if (chk.ok) return { text: out, warning: null };

  // (c) split smaller and clean each half — smaller pieces resist summarizing; insist too.
  // Cap the depth: on real (slow) Gemini each attempt costs ~2 min, so a stubborn chunk
  // must fail fast to a review-flag rather than grind for 10 minutes.
  const halves = splitInHalf(chunkText);
  if (halves && depth < 2) {
    onLog(`بخش ${index}: ریزتر می‌کنم و دوباره`);
    const a = await cleanChunkVerified(page, basePrompt, halves[0], { ...opts, hasNlmSummary, depth: depth + 1, insist: true });
    const b = await cleanChunkVerified(page, basePrompt, halves[1], { ...opts, hasNlmSummary: false, depth: depth + 1, insist: true });
    return { text: (a.text + '\n\n' + b.text).trim(), warning: a.warning || b.warning };
  }

  // (d) irreducible -> hand back what we have, flagged for the final gate
  return { text: out, warning: { index, reason: chk.reason } };
}

// Clean every chunk in order (Gemini is sequential on the active tab). Returns
// { text, warnings, ratio } — warnings feed the UI's "this part didn't finish" gate.
async function cleanAllChunks(page, basePrompt, chunks, opts = {}) {
  const { onLog = () => {}, onProgress = () => {}, minRatio = 0.85 } = opts;
  const parts = [];
  const warnings = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress({ index: i + 1, total: chunks.length });
    const res = await cleanChunkVerified(page, basePrompt, chunks[i], {
      index: i + 1, total: chunks.length, hasNlmSummary: i === 0, minRatio, onLog
    });
    if (res.warning) {
      warnings.push(res.warning);
      // drop a findable marker RIGHT where the doubtful text is, so review is pinpoint —
      // not "somewhere in the document". Search the output for ⚠️ to jump to each spot.
      parts.push(`⚠️ [بخشِ ${i + 1} — تأیید نشد: ${res.warning.reason}. این قسمت را با صوت مقایسه کن]\n\n${res.text}`);
    } else {
      parts.push(res.text);
    }
    onLog(`بخش ${i + 1}/${chunks.length} تمام${res.warning ? ' (با هشدار)' : ' ✓'}`);
  }
  const text = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, warnings };
}

module.exports = { checkCompleteness, cleanChunkVerified, cleanAllChunks, splitInHalf };
