/**
 * Import pipeline: pick a file → copy into app storage → parse → persist.
 *
 * Two-phase so the UI can ask the series question in between (Phase 5 Step B):
 *   1. `pickAndParseBook()` — DocumentPicker picks an epub/pdf/docx, we copy it
 *      into documents/books/ (survives cache eviction; kept for re-parsing),
 *      parse to plain-text chapters, strip scraper boilerplate. Returns a
 *      staged import (nothing in the DB yet), or null if the user cancelled.
 *   2. UI shows the series-assign choice (standalone / new series / add to
 *      existing as volume N).
 *   3. `commitImport(staged, assignment)` — saveBook + series link + FTS index.
 *      Or `discardStagedImport(staged)` if the user backs out.
 */
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";

import { indexChapter, saveBook, type BookFormat } from "./db";
import { parseDocx } from "./docx";
import { parseEpub } from "./epub";
import { ParseError, type ParsedBook } from "./parseTypes";
import { parsePdf } from "./pdf";
import { assignBookToSeries, createSeries } from "./seriesManager";
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

/** A parsed book copied into app storage but not yet saved to the DB. */
export interface StagedImport {
  fileUri: string;
  title: string;
  author?: string;
  format: BookFormat;
  coverDataUri?: string;
  chapterTitles: string[];
  /** Cleaned plain-text chapter bodies, parallel to chapterTitles. */
  chapters: string[];
}

export type SeriesAssignment =
  | { kind: "standalone" }
  | { kind: "new"; name: string; volumeNumber: number }
  | { kind: "existing"; seriesId: string; volumeNumber: number };

export async function pickAndParseBook(): Promise<StagedImport | null> {
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

  return {
    fileUri: destFile.uri,
    title,
    author: parsed.author,
    format: parsed.format,
    coverDataUri: parsed.coverDataUri,
    chapterTitles: parsed.chapters.map((c) => c.title),
    chapters: cleanedContent,
  };
}

/** Delete the staged copy when the user backs out of the series dialog. */
export function discardStagedImport(staged: StagedImport): void {
  try {
    new File(staged.fileUri).delete();
  } catch {
    /* best effort */
  }
}

/** Persist a staged import: book row, series link, FTS index. Returns bookId. */
export function commitImport(
  staged: StagedImport,
  assignment: SeriesAssignment,
): string {
  const bookId = saveBook({
    title: staged.title,
    author: staged.author,
    filePath: staged.fileUri,
    format: staged.format,
    coverUrl: staged.coverDataUri,
    chapterTitles: staged.chapterTitles,
    totalChapters: staged.chapters.length,
  });

  // Every book lives in a series (unified KB model, see db.ts) — standalone
  // just means a fresh 1-volume series named after the book.
  switch (assignment.kind) {
    case "standalone":
      assignBookToSeries(bookId, createSeries(staged.title), 1);
      break;
    case "new":
      assignBookToSeries(
        bookId,
        createSeries(assignment.name || staged.title),
        assignment.volumeNumber,
      );
      break;
    case "existing":
      assignBookToSeries(bookId, assignment.seriesId, assignment.volumeNumber);
      break;
  }

  // Index chapters for FTS5 search (diacritic-normalized inside indexChapter).
  staged.chapters.forEach((content, i) => indexChapter(bookId, i, content));

  return bookId;
}
