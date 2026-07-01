/**
 * Book-level AI orchestration. Phase 4 starts with auto-tagging; summary,
 * characters and power-system will hang off the same cache-first pattern.
 *
 * Cache-first is the whole point (see CLAUDE.md): one book = one analysis =
 * cached forever in `ai_cache`. We only hit Gemini when there's no cached tags
 * AND the user explicitly asks (via `generate`), so quota can't leak from
 * merely opening a book.
 *
 * The tags produced here use the closed ALLOWED_TAGS vocabulary, which is the
 * same key space as MUSIC_MAP — so once music.ts lands, these tags drive it
 * directly with no extra mapping.
 */
import { useCallback, useState } from "react";

import { generateTags, isGeminiConfigured, type BookTag } from "@/src/services/gemini";
import { getAICache, setAICache, updateBookTags, type Book } from "@/src/services/db";
import { useBookStore } from "@/src/store/bookStore";

/** How much text to send for tagging — enough to characterize genre/mood, small
 *  enough to stay well within the free-tier token budget. */
const TAG_SAMPLE_CHARS = 6000;

export type AIStatus = "idle" | "loading" | "done" | "error";

/**
 * Build a representative text sample from a book's chapters. Takes the opening
 * (sets tone/genre) plus a slice from the middle (avoids intro-only bias),
 * capped at `maxChars`.
 */
export function buildTagSample(chapters: string[], maxChars = TAG_SAMPLE_CHARS): string {
  if (chapters.length === 0) return "";
  const head = chapters[0] ?? "";
  const mid = chapters[Math.floor(chapters.length / 2)] ?? "";
  const budget = Math.floor(maxChars / 2);
  const sample = `${head.slice(0, budget)}\n\n${mid.slice(0, budget)}`.trim();
  return sample.slice(0, maxChars);
}

/**
 * Cache-first auto-tagging for the given book.
 *
 * @param book     the current book (null while loading a screen is fine)
 * @param chapters plain-text chapters, used to build the analysis sample
 *
 * Returns the current `tags`, a `status`, an `error` message, and:
 * - `generate()` — analyze now (cache-first; calls Gemini only on a miss)
 * - `regenerate()` — force a fresh Gemini call, ignoring cache
 */
export function useBookAI(book: Book | null, chapters: string[]) {
  const setStoreTags = useBookStore((s) => s.setTags);
  const [tags, setTags] = useState<BookTag[]>(() => (book?.tags as BookTag[]) ?? []);
  const [status, setStatus] = useState<AIStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    (bookId: string, next: BookTag[]) => {
      setAICache(bookId, "tags", JSON.stringify(next));
      updateBookTags(bookId, next);
      setTags(next);
      setStoreTags(next);
    },
    [setStoreTags],
  );

  const run = useCallback(
    async (force: boolean) => {
      if (!book) return;
      if (!isGeminiConfigured()) {
        setStatus("error");
        setError("Gemini API key not set (EXPO_PUBLIC_GEMINI_KEY).");
        return;
      }

      if (!force) {
        const cached = getAICache(book.id, "tags");
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as BookTag[];
            setTags(parsed);
            setStoreTags(parsed);
            setStatus("done");
            return;
          } catch {
            /* corrupt cache — fall through to a fresh call */
          }
        }
      }

      setStatus("loading");
      setError(null);
      try {
        const sample = buildTagSample(chapters);
        if (!sample) {
          setStatus("error");
          setError("No text available to analyze.");
          return;
        }
        const next = await generateTags(sample);
        apply(book.id, next);
        setStatus("done");
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : "AI tagging failed.");
      }
    },
    [book, chapters, apply, setStoreTags],
  );

  const generate = useCallback(() => run(false), [run]);
  const regenerate = useCallback(() => run(true), [run]);

  return { tags, status, error, generate, regenerate };
}
