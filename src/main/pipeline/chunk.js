// chunk.js — split a transcript into ~word-sized chunks on paragraph/whitespace
// boundaries so each stays complete through Gemini. Ported from chunk_transcript.py.
function chunkTranscript(text, wordsPerChunk = 2200) {
  const t = String(text || '').trim();
  if (!t) return [];
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = [];
  let cw = 0;
  const flush = () => { if (cur.length) { chunks.push(cur.join('\n\n')); cur = []; cw = 0; } };

  for (const p of paras) {
    const w = p.split(/\s+/).length;
    if (w > wordsPerChunk) {                 // a single huge paragraph -> hard split
      flush();
      const words = p.split(/\s+/);
      for (let i = 0; i < words.length; i += wordsPerChunk) chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
      continue;
    }
    if (cw + w > wordsPerChunk && cur.length) flush();
    cur.push(p); cw += w;
  }
  flush();
  return chunks;
}

module.exports = { chunkTranscript };
