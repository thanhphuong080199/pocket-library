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
 * Split text into chunks no larger than `maxLength`, breaking on sentence
 * boundaries where possible. Used by TTS (≤3000 chars) and AI chunking.
 */
export function splitIntoChunks(text: string, maxLength: number): string[] {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|\s*\S+\s*$/g) ?? [text];
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
