/**
 * Global state for the (single) in-flight knowledge-base analysis job. Lives
 * outside any screen so the whole-book pass survives navigation and can be
 * shown by an app-wide progress banner. The actual work + checkpointing is in
 * `src/services/kbRunner.ts`; this store is just the observable view of it.
 */
import { create } from "zustand";

export type KBJobStatus = "idle" | "running" | "paused" | "error" | "done";

export interface KBJob {
  seriesId: string;
  bookId: string;
  title: string;
  volumeNumber: number;
  /** Chunks completed so far. */
  current: number;
  total: number;
}

interface KBState {
  job: KBJob | null;
  status: KBJobStatus;
  error: string | null;
  /** epoch ms when a rate-limit-paused job will auto-retry (null if not scheduled). */
  retryAt: number | null;
  /** Shallow-merge a patch (used by the runner). */
  patch: (partial: Partial<Omit<KBState, "patch">>) => void;
}

export const useKBStore = create<KBState>((set) => ({
  job: null,
  status: "idle",
  error: null,
  retryAt: null,
  patch: (partial) => set(partial),
}));
