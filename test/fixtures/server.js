// server.js — a tiny local stand-in for NotebookLM & Gemini that mimics the exact DOM
// our automation depends on, so the real browser code can be tested headless with no
// Google account. Behaviour is deliberately adversarial where it matters (Gemini
// summarizes long inputs) so the anti-summarization loop is genuinely exercised.
const http = require('http');

const hex = () => Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

// A canned transcript > 3000 chars, prefixed with NLM's "Source guide" summary that
// stripSourceGuide() must remove. Contains a marker the test asserts on.
const SUMMARY = 'این خلاصهٔ خودکارِ NotebookLM است و باید کاملاً حذف شود. ';
const BODY = 'سلام علیکم، این یک رونویسیِ آزمایشی است که باید عیناً استخراج شود. مارکرِ استخراج: TRANSCRIPT_MARKER_XYZ. ' +
  'حالا مقداری متنِ محاوره‌ای که می‌گه و می‌خوام و نمی‌دونم توش هست تا طول کافی بشه. '.repeat(60);
const TRANSCRIPT_PANEL = 'voice_note.ogg button_magic Source guide arrow_drop_up' + SUMMARY + BODY;

const page = (title, body) => `<!doctype html><html lang="fa"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;

const nlmHome = page('NotebookLM', `
  <div class="mat-app"><button aria-label="Create new notebook" onclick="location.href='/newnotebook'">add Create new notebook</button></div>`);

const nlmNotebook = (id) => page('NotebookLM', `
  <section class="source-panel">
    <button class="mdc-button" onclick="document.getElementById('fi').click()">add Add sources / Upload files</button>
    <input id="fi" type="file" style="display:none" onchange="document.getElementById('src').style.display='block'">
    <div id="src" class="single-source-container">
      <button class="source-stretched-button">voice_note.ogg</button>
    </div>
    <div class="follow-up-chip">یک سؤالِ پیشنهادی</div>
    <div class="source-panel-view-content">${TRANSCRIPT_PANEL.replace(/</g, '&lt;')}</div>
  </section>
  <div>notebook ${id}</div>`);

// Gemini mock: <=300 words -> echo as clean paragraphs (passes the gate);
// >300 words -> a short summary containing «به‌طور خلاصه» (must be caught & recovered).
const geminiPage = page('Gemini', `
  <div class="input-area"><div class="ql-editor" contenteditable="true"></div></div>
  <button aria-label="Send message" onclick="reply()">send</button>
  <div id="log"></div>
  <script>
    function reply(){
      const ed=document.querySelector('.ql-editor');
      const full=(ed.innerText||'');
      const parts=full.split('---');
      const txt=(parts[parts.length-1]||'').trim();   // just the transcript chunk
      const words=txt.split(/\\s+/).filter(Boolean);
      const mc=document.createElement('message-content');
      if(words.length>300){
        mc.innerHTML='<p>به‌طور خلاصه، گوینده در این بخش دربارهٔ موضوعاتِ مختلفی صحبت می‌کند و نکاتی را بیان می‌نماید که در ادامه به‌اختصار آمده است.</p>';
      } else {
        // echo back "cleaned": a heading + the same words as a paragraph (ratio ~1)
        mc.innerHTML='<h2>بخش</h2><p>'+txt.replace(/</g,'&lt;')+'</p>';
      }
      document.getElementById('log').appendChild(mc);
      ed.innerText='';
    }
  </script>`);

function start() {
  const server = http.createServer((req, res) => {
    const url = req.url;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url === '/' || url.startsWith('/?')) return res.end(nlmHome);
    if (url === '/newnotebook') { res.statusCode = 302; res.setHeader('Location', '/notebook/' + hex()); return res.end(); }
    if (url.startsWith('/notebook/')) return res.end(nlmNotebook(url.split('/').pop()));
    if (url.startsWith('/gemini')) return res.end(geminiPage);
    res.statusCode = 404; res.end('nope');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { start, TRANSCRIPT_MARKER: 'TRANSCRIPT_MARKER_XYZ' };
