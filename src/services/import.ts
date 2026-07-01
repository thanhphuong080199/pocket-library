/**
 * Import pipeline: pick a file → copy into app storage → parse → persist.
 *
 * Flow:
 *   1. DocumentPicker picks an epub/pdf/docx (copied to cache).
 *   2. We copy it into the document directory so it survives cache eviction —
 *      the reader streams chapters from the parsed text, but we keep the
 *      original file for re-parsing / future features.
 *   3. Dispatch to the format parser → ParsedBook (plain-text chapters).
 *   4. saveBook + a standalone 1-volume series (the unified data model) +
 *      index every chapter into FTS5 for search.
 *
 * Returns the new bookId, or null if the user cancelled.
 */
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";

import {
  indexChapter,
  insertBookSeries,
  insertSeries,
  saveBook,
  updateSeriesVolumeCount,
  type BookFormat,
} from "./db";
import { parseDocx } from "./docx";
import { parseEpub } from "./epub";
import { ParseError, type ParsedBook } from "./parseTypes";
import { parsePdf } from "./pdf";
import { cleanBoilerplate } from "../utils/clean";

const ACCEPTED_MIME = [
  "application/epub+zip",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

function formatFromName(name: string): BookFormat | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "epub") return "epub";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  return null;
}

function parserFor(format: BookFormat): (uri: string) => Promise<ParsedBook> {
  switch (format) {
    case "epub":
      return parseEpub;
    case "pdf":
      return parsePdf;
    case "docx":
      return parseDocx;
  }
}

/** Strip the extension from a filename for use as a fallback title. */
function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

export async function importBook(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ACCEPTED_MIME,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const format = formatFromName(asset.name);
  if (!format) {
    throw new ImportError(
      `Unsupported file type: ${asset.name}. Import an EPUB, PDF, or DOCX.`,
    );
  }

  // Copy into permanent storage under documents/books/.
  const booksDir = new Directory(Paths.document, "books");
  if (!booksDir.exists) booksDir.create();
  const safeName = `${Date.now()}_${asset.name.replace(/[^\w.\-]+/g, "_")}`;
  const destFile = new File(booksDir, safeName);
  await new File(asset.uri).copy(destFile);

  // Parse.
  let parsed: ParsedBook;
  try {
    parsed = await parserFor(format)(destFile.uri);
  } catch (err) {
    // Don't leave an orphaned file behind on parse failure.
    try {
      destFile.delete();
    } catch {
      /* best effort */
    }
    if (err instanceof ParseError) throw new ImportError(err.message);
    throw new ImportError(`Couldn't read ${asset.name}. The file may be corrupt.`);
  }

  const title = parsed.title?.trim() || baseName(asset.name) || "Untitled";

  // Strip repeated headers/footers + ad lines injected by scraper sites.
  const cleanedContent = cleanBoilerplate(parsed.chapters.map((c) => c.content));

  // Persist book.
  const bookId = saveBook({
    title,
    author: parsed.author,
    filePath: destFile.uri,
    format: parsed.format,
    coverUrl: parsed.coverDataUri,
    chapterTitles: parsed.chapters.map((c) => c.title),
    totalChapters: parsed.chapters.length,
  });

  // Every book is a 1-volume standalone series (unified KB model, see db.ts).
  const seriesId = insertSeries(title);
  insertBookSeries(bookId, seriesId, 1);
  updateSeriesVolumeCount(seriesId, 1);

  // Index chapters for FTS5 search (diacritic-normalized inside indexChapter).
  cleanedContent.forEach((content, i) => indexChapter(bookId, i, content));

  return bookId;
}
