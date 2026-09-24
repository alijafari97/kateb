// smoke.js — exercises the deterministic core without any browser/Google.
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const { chunkTranscript } = require('../src/main/pipeline/chunk');
const { checkCompleteness, withoutNlmSummary } = require('../src/main/pipeline/verify');
const { buildOutputs } = require('../src/main/pipeline/output');

// 1) chunking
const sample = Array.from({ length: 20 }, (_, i) =>
  `پاراگرافِ شمارهٔ ${i + 1} برای آزمایشِ تکه‌بندی نوشته شده و چند کلمه دارد تا به حدِ کلمه برسیم، بله بله بله بله.`
).join('\n\n');
const chunks = chunkTranscript(sample, 40);
assert(chunks.length > 1, 'chunk should split into multiple pieces');
console.log(`chunk:      ${chunks.length} chunks  OK`);

// 2) anti-summarization gate — the core feature
const input = 'سلام علیکم. امروز می‌خوام دربارهٔ اسمِ یا معید صحبت کنم. یا معید یعنی بازگرداننده. خیلی مهمه که آدم به این اسم متخلق بشه و توی زندگیش پیاده کنه و همین‌طور ادامه بده تا آخرِ کار.';
const faithful   = 'سلام علیکم. امروز می‌خوام دربارهٔ اسمِ «یا مُعید» صحبت کنم. «یا مُعید» یعنی بازگرداننده. خیلی مهمه که آدم به این اسم متخلق بشه، و توی زندگی‌اش پیاده کنه، و همین‌طور ادامه بده تا آخرِ کار.';
const summarized = 'سخنران دربارهٔ اسمِ یا معید و اهمیتِ تخلق به آن به‌طور خلاصه صحبت می‌کند.';
const truncated  = 'سلام علیکم. امروز می‌خوام دربارهٔ اسمِ «یا مُعید» صحبت کنم. «یا مُعید» یعنی';

const cf = checkCompleteness(input, faithful, 0.85);
const cs = checkCompleteness(input, summarized, 0.85);
const ct = checkCompleteness(input, truncated, 0.85);
console.log('verify faithful  ->', JSON.stringify(cf));
console.log('verify summarized->', JSON.stringify(cs));
console.log('verify truncated ->', JSON.stringify(ct));
assert(cf.ok === true, 'faithful output must PASS');
assert(cs.ok === false && cs.kind === 'summary', 'summarized output must be caught as summary');
assert(ct.ok === false && ct.kind === 'truncated', 'truncated output must be caught as truncated');
console.log('verify:     3/3 cases  OK');

// 2b) the first chunk opens with NotebookLM's auto-summary, which the prompt tells Gemini to DROP —
//     so completeness is measured without it (else chunk 1 always looks "too short")
const nlmSum = 'این متن گفتگویی دربارهٔ محصول است که به فیچرهای مختلف می‌پردازد.';
const speech = 'آره می‌خوایم شروع کنیم. این فیچر برای اینه که کاربر راحت‌تر پیدا کنه.\n\nبعد می‌رسیم به بخشِ دوم.';
assert.strictEqual(withoutNlmSummary(nlmSum + '\n\n' + speech, true), speech, 'drops the leading NLM summary');
assert.strictEqual(withoutNlmSummary(nlmSum + '\n\n' + speech, false), nlmSum + '\n\n' + speech, 'keeps text when there is no summary');
assert.strictEqual(withoutNlmSummary('کوتاه\n\n' + 'x'.repeat(3), true), 'کوتاه\n\nxxx', 'never drops half the chunk');
const speechFirst = 'سلام علیکم، امروز دربارهٔ فیچرِ جدید صحبت می‌کنیم.\n\n' + speech + '\n\n' + speech;
assert.strictEqual(withoutNlmSummary(speechFirst, true), speechFirst, 'a first paragraph that is SPEECH is never dropped');
// realistic proportions: a short summary paragraph, then several paragraphs of speech
const talk = Array.from({ length: 6 }, (_, i) => `جملهٔ ${i + 1} از گفت‌وگو دربارهٔ این فیچر است که کاربر راحت‌تر پیدا کند.`);
const chunk1 = nlmSum + ' ' + nlmSum + '\n\n' + talk.join('\n\n');
const faithfulClean = talk.join(' ');
assert(!checkCompleteness(chunk1, faithfulClean, 0.85).ok, 'counting the summary fails a faithful chunk…');
assert(checkCompleteness(withoutNlmSummary(chunk1, true), faithfulClean, 0.85).ok, '…measured without it, it passes');
console.log('verify:     NLM summary excluded from the length check  OK');

// 3) real docx + md generation
(async () => {
  const dir = path.join(os.tmpdir(), 'kateb-test');
  const md = '# سخنرانی: یا مُعید\n\nاین متنِ آزمایشی است و باید عیناً در سند بیاید.\n\n## بخشِ دوم\n\nمتنِ بیشتری این‌جا.';
  const paths = await buildOutputs(md, { title: 'تستِ کاتب', dir, formats: { docx: true, md: true }, header: 'موسسه' });
  for (const p of paths) {
    const sz = fs.statSync(p).size;
    assert(sz > 0, 'output must be non-empty');
    console.log(`output:     ${path.basename(p)}  ${sz} bytes  OK`);
  }
  console.log('\nALL SMOKE TESTS PASSED ✓');
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
