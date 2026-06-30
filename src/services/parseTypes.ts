/**
 * Shared shape returned by every format parser (epub/pdf/docx). The import
 * pipeline (services/import.ts) consumes this regardless of source format.
 */
import type { BookFormat } from "./db";

export interface ParsedChapter {
  /** Display title for the TOC ("Chapter 3", a heading, "Page 12", …). */
  title: string;
  /** Plain-text body. */
  content: string;
}

export interface ParsedBook {
  title: string;
  author?: string;
  /** Chapters in spine/reading order. Always ≥ 1 entry. */
  chapters: ParsedChapter[];
  format: BookFormat;
  /**
   * Optional cover as a data URI (e.g. `data:image/jpeg;base64,...`) extracted
   * from the file. May be undefined; AI cover generation is a later fallback.
   */
  coverDataUri?: string;
}

/** Thrown when a picked file can't be parsed (corrupt, unsupported, empty). */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
