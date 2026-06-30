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

  setCurrentBook: (book: Book | null) => void;
  setChapters: (chapters: string[]) => void;
  setChapter: (index: number) => void;
  setPosition: (pos: ReadingPosition) => void;
  setTags: (tags: string[]) => void;
  reset: () => void;
}

export const useBookStore = create<BookState>((set) => ({
  currentBook: null,
  chapters: [],
  currentChapter: 0,
  readingPosition: { chapterIndex: 0, scrollY: 0 },
  tags: [],

  setCurrentBook: (currentBook) =>
    set({
      currentBook,
      tags: currentBook?.tags ?? [],
      currentChapter: currentBook?.lastPosition?.chapterIndex ?? 0,
      readingPosition: currentBook?.lastPosition ?? { chapterIndex: 0, scrollY: 0 },
    }),
  setChapters: (chapters) => set({ chapters }),
  setChapter: (currentChapter) => set({ currentChapter }),
  setPosition: (readingPosition) => set({ readingPosition }),
  setTags: (tags) => set({ tags }),
  reset: () =>
    set({
      currentBook: null,
      chapters: [],
      currentChapter: 0,
      readingPosition: { chapterIndex: 0, scrollY: 0 },
      tags: [],
    }),
}));
