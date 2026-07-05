/**
 * Book-level AI orchestration for the sampled, book-scoped text features:
 * **tags** and **story summary**. (Power system + character profiles are deeper
 * whole-book analyses handled by the series KB engine — see `useSeriesKB`.)
 *
 * Cache-first is the whole point (see CLAUDE.md): one book = one analysis =
 * cached forever in `ai_cache`. Each feature:
 *  - auto-hydrates from `ai_cache` when the book opens (free — no Gemini call),
 *  - only hits Gemini when the user explicitly asks (`generate` on a miss, or
 *    `regenerate` to force a refresh), so quota can't leak from opening a book.
 *
 * The tags feature additionally mirrors into `books.tags` + the book store,
 * because its closed ALLOWED_TAGS vocabulary is the same key space MUSIC_MAP
 * uses to pick background music.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  generateSummary,
  generateTags,
  isGeminiConfigured,
  type BookTag,
} from "@/src/services/gemini";
import { getAICache, setAICache, updateBookTags, type Book } from "@/src/services/db";
import { useBookStore } from "@/src/store/bookStore";

/** Sample size for tagging — enough to characterize genre/mood, small + cheap. */
const TAG_SAMPLE_CHARS = 6000;
/** Deeper analyses (summary/power/characters) get a wider spread of the book. */
const ANALYSIS_SAMPLE_CHARS = 12000;

export type AIStatus = "idle" | "loading" | "done" | "error";

export interface AIFeature<T> {
  data: T;
  status: AIStatus;
  error: string | null;
  /** Analyze now, cache-first (calls Gemini only on a cache miss). */
  generate: () => void;
  /** Force a fresh Gemini call, ignoring the cache. */
  regenerate: () => void;
  /**
   * Overwrite the value by hand (no Gemini call) and persist it exactly like a
   * fresh result — updates ai_cache, runs `persist`/`onData`. Lets the user
   * treat AI output as an editable suggestion (e.g. add/remove tags manually).
   */
  set: (value: T) => void;
}

/**
 * Build a representative text sample from a book's chapters. Takes the opening
 * (sets tone/genre) plus evenly-spaced slices deeper in (avoids intro-only
 * bias), capped at `maxChars`.
 */
export function buildSample(chapters: string[], maxChars: number): string {
  if (chapters.length === 0) return "";
  // Pick up to 3 anchor chapters: start, middle, and ~3/4 through.
  const picks = [0, Math.floor(chapters.length / 2), Math.floor((chapters.length * 3) / 4)];
  const uniq = [...new Set(picks)].filter((i) => i < chapters.length);
  const budget = Math.floor(maxChars / uniq.length);
  const sample = uniq.map((i) => (chapters[i] ?? "").slice(0, budget)).join("\n\n").trim();
  return sample.slice(0, maxChars);
}

/**
 * Generic cache-first AI feature. Handles the ai_cache read/write, status, and
 * error plumbing; each feature supplies how to (de)serialize and compute it.
 * Callbacks are read through a ref so `generate`/`regenerate` stay stable and
 * the auto-hydrate effect doesn't re-run on every render.
 */
function useAIFeature<T>(config: {
  book: Book | null;
  cacheKey: string;
  seed: T;
  fromCache: (raw: string) => T;
  toCache: (value: T) => string;
  compute: (book: Book) => Promise<T>;
  /** Called whenever data is set (cache hit or fresh) — e.g. mirror into a store. */
  onData?: (value: T) => void;
  /** Extra persistence after a fresh compute only (ai_cache is handled here). */
  persist?: (book: Book, value: T) => void;
  fallbackError: string;
}): AIFeature<T> {
  const { book, cacheKey, seed } = config;
  const cfg = useRef(config);
  cfg.current = config;

  const [data, setData] = useState<T>(seed);
  const [status, setStatus] = useState<AIStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Auto-hydrate from cache when the book changes. Free — never calls Gemini.
  useEffect(() => {
    if (!book) return;
    const cached = getAICache(book.id, cacheKey);
    if (!cached) return;
    try {
      const value = cfg.current.fromCache(cached);
      setData(value);
      cfg.current.onData?.(value);
      setStatus("done");
    } catch {
      /* corrupt cache — leave it; a manual generate will overwrite it */
    }
  }, [book?.id, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(
    async (force: boolean) => {
      const c = cfg.current;
      const b = c.book;
      if (!b) return;
      if (!isGeminiConfigured()) {
        setStatus("error");
        setError("Gemini API key not set (EXPO_PUBLIC_GEMINI_KEY).");
        return;
      }

      if (!force) {
        const cached = getAICache(b.id, c.cacheKey);
        if (cached) {
          try {
            const value = c.fromCache(cached);
            setData(value);
            c.onData?.(value);
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
        const value = await c.compute(b);
        setAICache(b.id, c.cacheKey, c.toCache(value));
        c.persist?.(b, value);
        setData(value);
        c.onData?.(value);
        setStatus("done");
      } catch (e) {
        setStatus("error");
        setError(e instanceof Error ? e.message : c.fallbackError);
      }
    },
    [], // reads everything through cfg.current
  );

  const generate = useCallback(() => void run(false), [run]);
  const regenerate = useCallback(() => void run(true), [run]);

  const set = useCallback((value: T) => {
    const c = cfg.current;
    const b = c.book;
    if (!b) return;
    setAICache(b.id, c.cacheKey, c.toCache(value));
    c.persist?.(b, value);
    setData(value);
    c.onData?.(value);
    setStatus("done");
  }, []);

  return { data, status, error, generate, regenerate, set };
}

/**
 * Cache-first AI features for a book. Pass the current book and its plain-text
 * chapters (used to build analysis samples). Each returned feature is an
 * independent {@link AIFeature}.
 */
export function useBookAI(book: Book | null, chapters: string[]) {
  const setStoreTags = useBookStore((s) => s.setTags);

  const tags = useAIFeature<BookTag[]>({
    book,
    cacheKey: "tags",
    seed: (book?.tags as BookTag[]) ?? [],
    fromCache: (raw) => JSON.parse(raw) as BookTag[],
    toCache: (v) => JSON.stringify(v),
    compute: () => generateTags(requireSample(chapters, TAG_SAMPLE_CHARS)),
    onData: setStoreTags,
    persist: (b, v) => updateBookTags(b.id, v),
    fallbackError: "AI tagging failed.",
  });

  const summary = useAIFeature<string>({
    book,
    cacheKey: "summary",
    seed: "",
    fromCache: (raw) => raw,
    toCache: (v) => v,
    compute: () => generateSummary(requireSample(chapters, ANALYSIS_SAMPLE_CHARS)),
    fallbackError: "AI summary failed.",
  });

  // Power system + character profiles now come from the whole-book KB engine
  // (see useSeriesKB / deltaExtractor), not a per-feature sampled call.
  return { tags, summary };
}

/** Build a sample and throw a clean error if the book has no text to analyze. */
function requireSample(chapters: string[], maxChars: number): string {
  const sample = buildSample(chapters, maxChars);
  if (!sample) throw new Error("No text available to analyze.");
  return sample;
}
