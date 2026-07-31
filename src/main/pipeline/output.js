// output.js — turn the cleaned markdown into local files: an RTL .docx (H1/H2) and a
// .md. No Google upload — output stays on the user's disk.
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

const FONT = 'Tahoma'; // renders Persian reliably on Windows & macOS

function safeName(title) {
  return String(title || 'سند').replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function rtl(text, opts = {}) {
  return new Paragraph({
    bidirectional: true,
    alignment: opts.alignment || AlignmentType.RIGHT,
    heading: opts.heading,
    bullet: opts.bullet ? { level: 0 } : undefined,
    spacing: { after: opts.heading ? 120 : 90, line: 320 },
    children: [new TextRun({ text, font: FONT, rightToLeft: true, size: opts.size, bold: opts.bold })]
  });
}

function markdownToParagraphs(md) {
  const paras = [];
  for (const raw of String(md || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    let m;
    if (line.startsWith('⚠️')) paras.push(rtl(line, { bold: true }));   // review marker — make it pop
    else if ((m = line.match(/^#\s+(.*)$/))) paras.push(rtl(m[1], { heading: HeadingLevel.HEADING_1 }));
    else if ((m = line.match(/^##\s+(.*)$/))) paras.push(rtl(m[1], { heading: HeadingLevel.HEADING_2 }));
    else if ((m = line.match(/^###\s+(.*)$/))) paras.push(rtl(m[1], { heading: HeadingLevel.HEADING_3 }));
    else if ((m = line.match(/^-\s+(.*)$/))) paras.push(rtl(m[1], { bullet: true }));
    else paras.push(rtl(line));
  }
  return paras;
}

async function writeDocx(cleanedText, { title, header, outPath }) {
  const head = [];
  if (header && header.trim()) head.push(rtl(header.trim(), { alignment: AlignmentType.CENTER, bold: true, size: 20 }));
  head.push(rtl(title, { heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }));
  const doc = new Document({
    creator: 'کاتب',
    title,
    styles: { default: { document: { run: { font: FONT, rightToLeft: true } } } },
    sections: [{ properties: { rtl: true }, children: [...head, ...markdownToParagraphs(cleanedText)] }]
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
  return outPath;
}

function writeMd(cleanedText, { title, header, outPath }) {
  const parts = [];
  if (header && header.trim()) parts.push(`> ${header.trim()}`, '');
  parts.push(cleanedText.trim(), '');
  fs.writeFileSync(outPath, parts.join('\n'), 'utf8');
  return outPath;
}

// Build whichever formats are enabled; returns the written file paths.
async function buildOutputs(cleanedText, { title, dir, formats = { docx: true, md: true }, header = '' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, safeName(title));
  const written = [];
  if (formats.docx) written.push(await writeDocx(cleanedText, { title, header, outPath: base + '.docx' }));
  if (formats.md) written.push(writeMd(cleanedText, { title, header, outPath: base + '.md' }));
  return written;
}

module.exports = { buildOutputs, safeName, markdownToParagraphs };
