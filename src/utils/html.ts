/**
 * Minimal HTML/XML → plain-text helpers.
 *
 * We deliberately avoid a DOM parser (none ships in RN/Hermes and a full one is
 * heavy). EPUB chapters and DOCX bodies are well-formed XHTML, so regex
 * stripping is sufficient for our needs: reader display, TTS, AI, and FTS all
 * want plain readable text, not layout fidelity.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
};

/** Decode the handful of HTML entities that show up in real ebooks. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Convert an HTML/XHTML fragment to readable plain text. Block-level tags
 * become paragraph breaks; everything else is dropped. Whitespace is collapsed
 * so the reader and TTS get clean prose.
 */
export function htmlToText(html: string): string {
  if (!html) return "";

  let text = html
    // Drop non-content elements entirely (including their contents).
    .replace(/<(script|style|head|title)[\s\S]*?<\/\1>/gi, "")
    // Comments.
    .replace(/<!--[\s\S]*?-->/g, "")
    // Line/paragraph breaks → newlines so we keep prose structure.
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // Everything else: strip the tag.
    .replace(/<[^>]+>/g, "");

  text = decodeEntities(text);

  // Normalise whitespace: collapse runs of spaces/tabs, trim each line, and
  // squeeze 3+ blank lines down to a single blank line between paragraphs.
  text = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
