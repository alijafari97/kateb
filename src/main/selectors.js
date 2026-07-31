// selectors.js — All the brittle DOM knowledge for NotebookLM & Gemini in ONE place,
// so a UI change on Google's side is a small patch here (see design: risk #2).
// Ported from the field-proven openclaw automation.

module.exports = {
  notebooklm: {
    home: 'https://notebooklm.google.com/',
    notebookUrl: (id) => `https://notebooklm.google.com/notebook/${id}`,
    // NLM's Sources panel COLLAPSES below ~1200px and the .mp3 source button vanishes.
    minViewport: { width: 1500, height: 1000 },
    // "Create new notebook" button — matched on aria-label OR text.
    createRe: /Create new notebook|Create notebook/i,
    // After create, NLM opens the "Add sources" dialog (?addSource=true). The
    // "Upload files" button must be clicked with a TRUSTED click to open the OS file
    // chooser (a synthetic dispatchEvent click won't). The hidden <input type=file>
    // only appears after that click.
    uploadButton: 'button:has-text("Upload files")',
    addSourceButton: 'button:has-text("Add source")',
    // A source chip shows the file name; audio sources contain ".mp3".
    sourceRe: /\.mp3/i,
    // Transcript lives here once the source is opened.
    transcriptSel: '.source-panel-view-content',
    // "Source guide" is NLM's auto-summary; strip everything up to and including it.
    sourceGuideRe: /Source guide\s*arrow_drop_(up|down)/,
    // Follow-up suggestion chips only appear AFTER the source is fully processed.
    processedSel: '.follow-up-chip, [class*="follow-up"]',
    // Notebook-title input (for renaming, optional).
    titleInputSel: 'input.title-input',
    minTranscriptChars: 3000
  },

  gemini: {
    home: 'https://gemini.google.com/app',
    editorSel: 'div.ql-editor',
    sendSel: 'button[aria-label="Send message"]',
    // Each model reply is a <message-content> element.
    responseSel: 'message-content',
    // A visible "stop"/generating control means the reply is still streaming.
    stopRe: /stop/i,
    // Gemini's chat input silently caps around here; keep chunks well under it.
    maxInputChars: 30000
  },

  google: {
    // Signals that the interactive session needs the human (login / "verify it's you").
    challengeRe: /Verify it.?s you|sign in again|does not have permission|Couldn.?t sign you in|403\./i,
    accountHint: 'alijafari2019@gmail.com'
  }
};
