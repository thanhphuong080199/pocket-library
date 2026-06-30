/**
 * PDF parser. PDFs have no plain-text structure we can read directly, so we run
 * pdf.js inside a hidden WebView (components/PdfExtractorHost) and talk to it
 * through pdfBridge. See pdfBridge.ts for the why (react-native-pdf is banned;
 * pdf.js needs a browser env).
 *
 * Each PDF page becomes one "chapter". Pages with no extractable text are
 * dropped — a fully empty result usually means a scanned/image-only PDF, which
 * we can't read without OCR.
 */
import { File } from "expo-file-system";

import { ParseError, type ParsedBook } from "./parseTypes";
import { extractPdfText } from "./pdfBridge";

export async function parsePdf(fileUri: string): Promise<ParsedBook> {
  const base64 = new File(fileUri).base64Sync();

  let result;
  try {
    result = await extractPdfText(base64);
  } catch (err) {
    throw new ParseError(err instanceof Error ? err.message : "Couldn't read the PDF.");
  }

  // One chapter per page. Track the original page number for the TOC label so
  // dropped (empty) pages don't renumber the rest.
  const pages = result.pages
    .map((p, i) => ({
      page: i + 1,
      content: p.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    }))
    .filter((p) => p.content.length > 0);

  if (pages.length === 0) {
    throw new ParseError(
      "No selectable text found — this looks like a scanned PDF (images only), which can't be read without OCR.",
    );
  }

  return {
    title: result.title?.trim() || "Untitled",
    author: result.author?.trim() || undefined,
    chapters: pages.map((p) => ({ title: `Page ${p.page}`, content: p.content })),
    format: "pdf",
  };
}
