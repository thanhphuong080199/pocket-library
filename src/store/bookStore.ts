/**
 * Transient state for the book currently open in the reader.
 * (Not persisted — reading position is written through to SQLite via db.ts.)
 */
import { create } from "zustand";

import type { Book, ReadingPosition } from "../services/db";

interface BookState {
  currentBook: Book | null;
  /** Plain-text chapters of the current book, for TTS / search / AI. */
  chapters: string[];
  currentChapter: number;
  readingPosition: ReadingPosition;
  tags: string[];
  /**
   * One-shot scroll request the reader consumes after layout, then clears.
   * Drives "resume where I left off" and jumps from search/chapters while the
   * reader is already mounted (it's a tab, so it doesn't remount on navigate).
   */
  pendingScrollY: number | null;
  /** One-shot jump to a specific paragraph (bookmarks). Reader scrolls to its
   * measured offset once laid out. */
  pendingParagraph: number | null;

  setCurrentBook: (book: Book | null) => void;
  setChapters: (chapters: string[]) => void;
  setChapter: (index: number) => void;
  setPosition: (pos: ReadingPosition) => void;
  setTags: (tags: string[]) => void;
  /** Jump to a chapter + pixel offset (search hit, chapter list, resume). */
  jumpTo: (chapterIndex: number, scrollY: number) => void;
  /** Jump to a chapter + paragraph (bookmark). */
  jumpToParagraph: (chapterIndex: number, paragraphIndex: number) => void;
  setPendingScrollY: (y: number | null) => void;
  setPendingParagraph: (p: number | null) => void;
  reset: () => void;
}

export const useBookStore = create<BookState>((set) => ({
  currentBook: null,
  chapters: [],
  currentChapter: 0,
  readingPosition: { chapterIndex: 0, scrollY: 0 },
  tags: [],
  pendingScrollY: null,
  pendingParagraph: null,

  setCurrentBook: (currentBook) =>
    set({
      currentBook,
      tags: currentBook?.tags ?? [],
      currentChapter: currentBook?.lastPosition?.chapterIndex ?? 0,
      readingPosition: currentBook?.lastPosition ?? { chapterIndex: 0, scrollY: 0 },
      // Resume at the saved offset when a book is (re)opened.
      pendingScrollY: currentBook?.lastPosition?.scrollY ?? 0,
      pendingParagraph: null,
    }),
  setChapters: (chapters) => set({ chapters }),
  setChapter: (currentChapter) => set({ currentChapter }),
  setPosition: (readingPosition) => set({ readingPosition }),
  setTags: (tags) => set({ tags }),
  jumpTo: (chapterIndex, scrollY) =>
    set({ currentChapter: chapterIndex, pendingScrollY: scrollY, pendingParagraph: null }),
  jumpToParagraph: (chapterIndex, paragraphIndex) =>
    set({
      currentChapter: chapterIndex,
      pendingParagraph: paragraphIndex,
      pendingScrollY: null,
    }),
  setPendingScrollY: (pendingScrollY) => set({ pendingScrollY }),
  setPendingParagraph: (pendingParagraph) => set({ pendingParagraph }),
  reset: () =>
    set({
      currentBook: null,
      chapters: [],
      currentChapter: 0,
      readingPosition: { chapterIndex: 0, scrollY: 0 },
      tags: [],
      pendingScrollY: null,
      pendingParagraph: null,
    }),
}));
