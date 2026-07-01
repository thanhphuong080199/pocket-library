/**
 * Boilerplate / ad stripping for imported ebooks.
 *
 * Scraped free ebooks (esp. Vietnamese translated web-novels) inject junk:
 *   - a site URL / promo line repeated as a header or footer on every chapter,
 *   - inline ad lines ("đọc truyện tại ...", telegram/facebook plugs, URLs).
 *
 * We clean at import time (once), so the stored/indexed text stays clean. Two
 * conservative passes, biased toward NOT deleting real prose:
 *
 *  1. Cross-chapter repetition — a short line that shows up in most chapters is
 *     almost certainly a running header/footer, not content. Needs enough
 *     chapters to be confident.
 *  2. Per-line ad patterns — a line that is essentially a URL, or carries a
 *     high-signal promo phrase, is dropped regardless of repetition.
 *
 * Existing books are already stored; re-import to apply cleaning to them.
 */

/** A line must appear in at least this fraction of chapters to count as a header/footer. */
const REPEAT_FRACTION = 0.6;
/** ...and we only trust repetition when there are at least this many chapters. */
const MIN_CHAPTERS_FOR_REPEAT = 4;
/** Repeated lines longer than this are left alone (likely real prose, not a header). */
const MAX_REPEAT_LINE_LEN = 200;

/** Global so we can strip every URL occurrence from a line (not just detect one). */
const URL_RE = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|net|org|vn|info|xyz|top|me)\b\S*/gi;

/** High-signal promo phrases (lowercased, diacritic-insensitive compare via includes). */
const AD_PHRASES = [
  "truyenfull",
  "truyen full",
  "sstruyen",
  "tangthuvien",
  "tàng thư viện",
  "wattpad",
  "vip.txt",
  "nguồn:",
  "nguồn :",
  "đọc truyện tại",
  "đọc tiếp tại",
  "bạn đang đọc",
  "biên tập:",
  "convert by",
  "converter:",
  "dịch:",
  "edit:",
  "beta:",
  "t.me/",
  "telegram",
  "fb.com",
  "facebook.com",
  "vui lòng không sao chép",
];

/**
 * Clean a single line of ads. Returns the cleaned text, or `null` if the whole
 * line was an ad and should be dropped.
 *  - An ad *phrase* (e.g. "đọc truyện tại") marks the whole line as a plug → drop.
 *  - A URL is stripped in place, so prose that merely ends in a link survives;
 *    the line is only dropped if nothing meaningful remains.
 */
function stripAdLine(line: string): string | null {
  const t = line.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (AD_PHRASES.some((p) => lower.includes(p))) return null;
  const withoutUrls = t.replace(URL_RE, " ").replace(/\s+/g, " ").trim();
  if (!withoutUrls || isSeparator(withoutUrls)) return null;
  return withoutUrls;
}

/** True if a line is just separators/punctuation (keep these — they're scene breaks). */
function isSeparator(line: string): boolean {
  return !/[\p{L}\p{N}]/u.test(line);
}

/** Normalize a line for repetition counting (collapse whitespace, lowercase). */
function repeatKey(line: string): string {
  return line.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Clean an array of chapter texts. Returns the cleaned texts in the same order.
 */
export function cleanBoilerplate(chapters: string[]): string[] {
  const perChapterLines = chapters.map((c) => c.split(/\r?\n/));

  // Pass 1: find lines that repeat across many chapters (headers/footers).
  const chapterCount = chapters.length;
  const repeated = new Set<string>();
  if (chapterCount >= MIN_CHAPTERS_FOR_REPEAT) {
    const chaptersContaining = new Map<string, number>();
    for (const lines of perChapterLines) {
      const seen = new Set<string>();
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.length > MAX_REPEAT_LINE_LEN || isSeparator(t)) continue;
        const key = repeatKey(t);
        if (seen.has(key)) continue; // count each line once per chapter
        seen.add(key);
        chaptersContaining.set(key, (chaptersContaining.get(key) ?? 0) + 1);
      }
    }
    const threshold = Math.max(MIN_CHAPTERS_FOR_REPEAT * REPEAT_FRACTION, chapterCount * REPEAT_FRACTION);
    for (const [key, count] of chaptersContaining) {
      if (count >= threshold) repeated.add(key);
    }
  }

  // Pass 2: drop repeated headers/footers, strip inline ads, per chapter.
  return perChapterLines.map((lines) => {
    const kept: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) {
        kept.push(""); // preserve blank lines (paragraph structure)
        continue;
      }
      if (repeated.has(repeatKey(t))) continue;
      const cleaned = stripAdLine(t);
      if (cleaned === null) continue; // whole line was an ad
      kept.push(cleaned);
    }
    // Collapse the runs of blank lines that removals may have opened up.
    return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  });
}
