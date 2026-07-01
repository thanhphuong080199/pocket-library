/**
 * Text utilities. Vietnamese-aware.
 */

/**
 * Strip diacritics + lowercase so FTS5 (which has no Vietnamese folding)
 * can match accent-insensitively. Used for BOTH stored content and queries.
 * "Nguyễn" -> "nguyen". Also folds the Vietnamese đ/Đ which NFD does not.
 */
export function normalizeVietnamese(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritic marks
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * Clean a passage for text-to-speech so the engine doesn't spell out decorative
 * symbols/punctuation ("dấu sao", "gạch ngang", "dot dot dot"). Only affects
 * what is *spoken* — the reader still shows the original text.
 *
 * Keeps sentence-ending punctuation (. ! ? , ; :) because the engine uses it for
 * pauses and sentence melody; ellipses/dashes become a comma (a natural pause)
 * rather than being read aloud; quotes/brackets and markup symbols are dropped.
 */
export function sanitizeForSpeech(text: string): string {
  return text
    .replace(/[“”„‟"«»「」『』()[\]{}<>]/g, " ") // quotes/brackets → silence
    .replace(/[*_~#`^|\\/=+@©®™•]/g, " ") // markup/decorative symbols engines spell out
    .replace(/(?:\.{2,}|…)/g, ", ") // ellipsis → pause (not "chấm chấm chấm")
    .replace(/\s[–—-]+\s/g, ", ") // spaced dashes → pause
    .replace(/[–—-]{2,}/g, " ") // dash runs (scene breaks) → space
    .replace(/([!?.,;:])\1+/g, "$1") // collapse repeated punctuation (!!! → !)
    .replace(/\s+([,.!?;:])/g, "$1") // drop space before punctuation
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Split a chapter's plain text into display paragraphs: blank-line separated,
 * falling back to single newlines when there are no blank lines. This is the
 * exact unit the reader renders *and* the unit TTS reports as a "segment", so
 * both the reader and the background playback session must split identically.
 */
export function splitParagraphs(text: string): string[] {
  if (!text) return [];
  let parts = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) parts = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [text];
}

/**
 * Split text into chunks no larger than `maxLength`, breaking on sentence
 * boundaries where possible. Used by TTS (≤3000 chars) and AI chunking.
 */
export function splitIntoChunks(text: string, maxLength: number): string[] {
  // Match each sentence (run of text ending in terminal punctuation), OR a
  // trailing run with no terminal punctuation. The tail alternative must be
  // `[^.!?。！？]+$` (the whole remainder) — an earlier `\s*\S+\s*$` grabbed only
  // the LAST word, silently dropping the rest of an unpunctuated line.
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxLength && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
