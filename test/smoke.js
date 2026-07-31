// smoke.js — exercises the deterministic core without any browser/Google.
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');
const { chunkTranscript } = require('../src/main/pipeline/chunk');
const { checkCompleteness } = require('../src/main/pipeline/verify');
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
