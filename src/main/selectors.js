// selectors.js — All the brittle DOM knowledge for NotebookLM & Gemini in ONE place,
// so a UI change on Google's side is a small patch here (see design: risk #2).
// Ported from the field-proven openclaw automation.

module.exports = {
  notebooklm: {
    home: 'https://notebook.google.com/',   // rebranded «Gemini Notebook» (Sep 2026); old host redirects here
    notebookUrl: (id) => `https://notebook.google.com/notebook/${id}`,
    // NLM's Sources panel COLLAPSES below ~1200px and the .mp3 source button vanishes.
    minViewport: { width: 1500, height: 1000 },
    // The create-notebook button — Google renamed it "Create new notebook" -> "New notebook"
    // (Sep 2026). Match both, plus Persian, so a future rename doesn't wedge the login check.
    createRe: /New notebook|Create new notebook|Create notebook|نوت‌?بوکِ? ?(جدید|نو)|ساختِ? ?نوت‌?بوک/i,
    // After create, NLM opens the "Add sources" dialog (?addSource=true). The
    // "Upload files" button must be clicked with a TRUSTED click to open the OS file
    // chooser (a synthetic dispatchEvent click won't). The hidden <input type=file>
    // only appears after that click.
    uploadButton: 'button:has-text("Upload files")',
    addSourceButton: 'button:has-text("Add source")',
    // A source chip shows the file name. Match ANY audio extension — voice notes are
    // .ogg/.m4a/.opus, NOT .mp3 (matching only .mp3 left non-mp3 uploads "uploading" forever).
    sourceRe: /\.(mp3|m4a|wav|aac|ogg|oga|opus|mp4|flac|mpeg|mpga|weba|webm|3gp|amr|aiff?)/i,
    // Transcript lives here once the source is opened.
    transcriptSel: '.source-panel-view-content',
    // "Source guide" is NLM's auto-summary; strip everything up to and including it.
    sourceGuideRe: /Source guide\s*arrow_drop_(up|down)/,
    // Follow-up suggestion chips only appear AFTER the source is fully processed.
    processedSel: '.follow-up-chip, [class*="follow-up"]',
    // Notebook-title input (for renaming, optional).
    titleInputSel: 'input.title-input',
    // Opening a source needs a TRUSTED click on its title (Gemini Notebook ignores synthetic clicks).
    sourceTitleSel: '.source-title',
    // Panel text (guide + transcript) must reach this AND hold steady. Low enough for short voice notes.
    minTranscriptChars: 400
  },

  gemini: {
    home: 'https://gemini.google.com/app',
    editorSel: 'div.ql-editor',
    sendSel: 'button[aria-label="Send message"]',
    // Each model reply is a <message-content> element.
    responseSel: 'message-content',
    // Model picker ("Open mode picker, currently Flash"). Flash refuses long dense Persian
    // technical transcripts ("I'm a language model… beyond what I'm designed for"); Pro cleans them.
    modePickerSel: 'button[aria-label^="Open mode picker"]',
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
