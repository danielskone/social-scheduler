// Cleans what the speech finder (Whisper) writes. In songs it often "hears" music notes, and
// those come out as broken pieces like "<0xAB>" or "?" instead of a real character. They are
// not words, so they are taken out of captions, titles and clip text.
const JUNK = /<0x[0-9a-f]{2}>|[�♪-♯♩]|\u{1F3B5}|\u{1F3B6}|\u{1F3BC}/giu;

function cleanText(s) {
  return String(s || '').replace(JUNK, ' ').replace(/\s+/g, ' ').trim();
}

// A whole transcript: junk taken out of every sentence and word; empty ones dropped.
function cleanTranscript(t) {
  if (!t || !Array.isArray(t.segments)) return t;
  const segments = t.segments.map((s) => ({
    ...s,
    text: cleanText(s.text),
    words: (s.words || []).map((w) => ({ ...w, text: cleanText(w.text) })).filter((w) => w.text && /[\p{L}\p{N}]/u.test(w.text)),
  })).filter((s) => /[\p{L}\p{N}]/u.test(s.text));
  return { ...t, segments };
}

module.exports = { cleanText, cleanTranscript };
