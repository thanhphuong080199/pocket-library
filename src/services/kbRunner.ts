/**
 * Background runner for the whole-book knowledge-base pass.
 *
 * Owns the chunk loop so it can run detached from any screen (survives
 * navigation) and stay resilient to the free-tier rate limit:
 *  - **Checkpoint every chunk** (`kb_analysis` table) → resume after a pause or
 *    an app close, without re-spending quota on already-processed chunks.
 *  - **Rate-limit = pause, not fail.** When every model is cooling down
 *    (`GeminiRateLimitError`) we stop on the current chunk and schedule an
 *    auto-resume once a model frees up; the user can also resume manually.
 *  - **Pacing.** A short gap between chunks avoids bursting the per-minute cap.
 *
 * Single active job at a time (personal app). State is mirrored into `kbStore`
 * for the UI; the DB checkpoint is the source of truth for resume.
 */
import {
  clearAnalysisState,
  clearSeriesKB,
  getAnalysisState,
  getBook,
  getBookVolume,
  getChapters,
  getInterruptedAnalysis,
  getSeriesIdForBook,
  setAnalysisState,
  updateSeriesVolumeCount,
} from "./db";
import {
  chunkChapters,
  extractAndMergeChunk,
  loadSnapshot,
  type BookChunk,
} from "./deltaExtractor";
import { GeminiRateLimitError, isGeminiConfigured, nextModelReadyInMs } from "./gemini";
import { useKBStore, type KBJob } from "@/src/store/kbStore";

/** Gap between chunk requests — cheap insurance against the per-minute cap. */
const PACING_MS = 1500;
/** Extra wait past the model cooldown before an auto-resume, and a floor. */
const RETRY_BUFFER_MS = 5_000;
const MIN_RETRY_MS = 30_000;

let running = false;
let cancelRequested = false;
/** Aborts the in-flight Gemini request so Cancel takes effect immediately. */
let abortController: AbortController | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const patch = (p: Parameters<ReturnType<typeof useKBStore.getState>["patch"]>[0]) =>
  useKBStore.getState().patch(p);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Analysis failed.");

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

export function isAnalysisRunning(): boolean {
  return running;
}

/** Start (or resume-from-checkpoint) analysis for a book. `fresh` wipes first. */
export function analyzeBook(bookId: string, opts: { fresh: boolean }): void {
  const seriesId = getSeriesIdForBook(bookId);
  if (!seriesId) {
    patch({ status: "error", error: "This book isn't part of a series." });
    return;
  }
  void beginRun(seriesId, bookId, opts.fresh);
}

/** Resume a paused/interrupted series analysis from its checkpoint. */
export function resumeSeries(seriesId: string): void {
  const cp = getAnalysisState(seriesId);
  if (!cp || cp.status === "done") return;
  void beginRun(seriesId, cp.bookId, false);
}

/** Resume whatever run was left mid-flight (used on app launch). */
export function resumeInterrupted(): void {
  const cp = getInterruptedAnalysis();
  if (cp) resumeSeries(cp.seriesId);
}

/**
 * On launch, surface an interrupted run in the banner as *paused* (does NOT
 * auto-resume — that would spend quota unprompted). The user taps Resume.
 */
export function hydrateInterrupted(): void {
  if (running || useKBStore.getState().job) return;
  const cp = getInterruptedAnalysis();
  if (!cp) return;
  patch({
    job: {
      seriesId: cp.seriesId,
      bookId: cp.bookId,
      title: getBook(cp.bookId)?.title ?? "Book",
      volumeNumber: cp.volumeNumber,
      current: cp.nextChunk,
      total: cp.totalChunks,
    },
    status: "paused",
    error: "Analysis was interrupted — tap Resume to continue.",
    retryAt: null,
  });
}

/**
 * Stop the current run (or a scheduled auto-retry). The checkpoint is kept, so
 * it stays resumable; the UI can offer "Resume".
 */
export function cancelAnalysis(): void {
  clearRetry();
  if (running) {
    cancelRequested = true;
    abortController?.abort(); // kill the in-flight request so cancel is immediate
  } else {
    patch({ status: "paused", retryAt: null });
  }
}

/** Clear the banner without resuming (checkpoint, if any, is left intact). */
export function dismissJob(): void {
  clearRetry();
  if (!running) patch({ job: null, status: "idle", error: null, retryAt: null });
}

async function beginRun(seriesId: string, bookId: string, fresh: boolean): Promise<void> {
  if (running) return;
  if (!isGeminiConfigured()) {
    patch({ status: "error", error: "Gemini API key not set (EXPO_PUBLIC_GEMINI_KEY)." });
    return;
  }

  const chunks = chunkChapters(getChapters(bookId));
  if (chunks.length === 0) {
    patch({ status: "error", error: "No text available to analyze." });
    return;
  }
  if (fresh) {
    clearSeriesKB(seriesId);
    clearAnalysisState(seriesId);
  }

  const volumeNumber = getBookVolume(bookId);
  const title = getBook(bookId)?.title ?? "Book";

  // Resume point: pick up where the checkpoint left off if the book is unchanged.
  let startChunk = 0;
  if (!fresh) {
    const cp = getAnalysisState(seriesId);
    if (cp && cp.totalChunks === chunks.length && cp.status !== "done") {
      startChunk = Math.min(cp.nextChunk, chunks.length);
    }
  }

  const job: KBJob = { seriesId, bookId, title, volumeNumber, current: startChunk, total: chunks.length };
  patch({ job, status: "running", error: null, retryAt: null, minimized: false });
  setAnalysisState({ seriesId, bookId, volumeNumber, nextChunk: startChunk, totalChunks: chunks.length, status: "running" });

  await runLoop(job, chunks, startChunk);
}

async function runLoop(job: KBJob, chunks: BookChunk[], startChunk: number): Promise<void> {
  running = true;
  cancelRequested = false;
  abortController = new AbortController();
  clearRetry();

  const save = (nextChunk: number, status: "running" | "paused" | "error" | "done") =>
    setAnalysisState({
      seriesId: job.seriesId,
      bookId: job.bookId,
      volumeNumber: job.volumeNumber,
      nextChunk,
      totalChunks: chunks.length,
      status,
    });

  try {
    // Snapshot reflects chunks [0, startChunk) already merged in the DB.
    const snapshot = loadSnapshot(job.seriesId);

    for (let i = startChunk; i < chunks.length; i++) {
      if (cancelRequested) {
        save(i, "paused");
        patch({ job: { ...job, current: i }, status: "paused", retryAt: null });
        return;
      }

      patch({ job: { ...job, current: i } }); // chunk i is now in flight
      try {
        await extractAndMergeChunk(job.seriesId, snapshot, chunks[i], job.volumeNumber, abortController.signal);
      } catch (e) {
        // A user cancel (aborted request) pauses at the current chunk, keeping
        // the checkpoint so it stays resumable.
        if (cancelRequested || abortController.signal.aborted) {
          save(i, "paused");
          patch({ job: { ...job, current: i }, status: "paused", retryAt: null });
          return;
        }
        if (e instanceof GeminiRateLimitError) {
          save(i, "paused"); // stay on this chunk
          if (cancelRequested) {
            patch({ job: { ...job, current: i }, status: "paused", retryAt: null });
          } else {
            scheduleRetry(job.seriesId, i, chunks.length);
          }
          return;
        }
        save(i, "error");
        patch({ status: "error", error: errMsg(e), retryAt: null });
        return;
      }

      const done = i + 1;
      save(done, "running");
      patch({ job: { ...job, current: done } });
      if (done < chunks.length) await sleep(PACING_MS);
    }

    // Finished the whole book.
    updateSeriesVolumeCount(job.seriesId, job.volumeNumber);
    clearAnalysisState(job.seriesId);
    patch({ job: { ...job, current: chunks.length }, status: "done", retryAt: null });
  } finally {
    running = false;
  }
}

function scheduleRetry(seriesId: string, chunkIndex: number, total: number): void {
  const wait = Math.max(nextModelReadyInMs() + RETRY_BUFFER_MS, MIN_RETRY_MS);
  patch({
    status: "paused",
    error: `Rate limited at chunk ${chunkIndex + 1}/${total}. Waiting to resume…`,
    retryAt: Date.now() + wait,
  });
  clearRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    resumeSeries(seriesId);
  }, wait);
}
