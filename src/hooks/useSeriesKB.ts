/**
 * Book/series knowledge-base hook: exposes the accumulated KB for a book's
 * series plus controls to drive the background whole-book analysis.
 *
 * Reading the KB is free (SQLite) and refreshes as the background job (see
 * `kbRunner` + `kbStore`) makes progress, so characters/power appear live. The
 * analysis itself runs detached from this screen, so navigating away doesn't
 * stop it and a rate-limit pause can auto-resume.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { analyzeBook, resumeSeries } from "@/src/services/kbRunner";
import { getSeriesKB, isKBEmpty, type SeriesKB } from "@/src/services/knowledgeBase";
import {
  getAnalysisState,
  getSeriesIdForBook,
  type Book,
  type KBAnalysisState,
} from "@/src/services/db";
import { useKBStore } from "@/src/store/kbStore";

const EMPTY_KB: SeriesKB = { powerStages: [], characters: [], lore: [] };

export type KBStatus = "idle" | "running" | "paused" | "error" | "done";

export function useSeriesKB(book: Book | null) {
  const seriesId = useMemo(() => (book ? getSeriesIdForBook(book.id) : null), [book?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [kb, setKb] = useState<SeriesKB>(EMPTY_KB);
  const [checkpoint, setCheckpoint] = useState<KBAnalysisState | null>(null);

  const job = useKBStore((s) => s.job);
  const jobStatus = useKBStore((s) => s.status);
  const jobError = useKBStore((s) => s.error);
  const retryAt = useKBStore((s) => s.retryAt);

  // Is the store's active job for *this* book's series?
  const mine = !!seriesId && job?.seriesId === seriesId;

  const reload = useCallback(() => {
    if (!seriesId) {
      setKb(EMPTY_KB);
      setCheckpoint(null);
      return;
    }
    setKb(getSeriesKB(seriesId));
    setCheckpoint(getAnalysisState(seriesId));
  }, [seriesId]);

  // Reload on open and whenever our job advances/settles (live character list).
  // `job` is a fresh object on every runner patch, so this re-reads per chunk.
  useEffect(() => {
    reload();
  }, [reload, mine, job, jobStatus]);

  const analyze = useCallback(() => book && analyzeBook(book.id, { fresh: false }), [book]);
  const reanalyze = useCallback(() => book && analyzeBook(book.id, { fresh: true }), [book]);
  const resume = useCallback(() => seriesId && resumeSeries(seriesId), [seriesId]);

  // Status for this book: the live job if it's ours, else derived from the DB.
  const status: KBStatus = mine
    ? jobStatus
    : checkpoint && checkpoint.status !== "done"
      ? "paused"
      : isKBEmpty(kb)
        ? "idle"
        : "done";

  return {
    kb,
    status,
    error: mine ? jobError : null,
    progress: mine && job ? { current: job.current, total: job.total } : null,
    retryAt: mine ? retryAt : null,
    /** A resumable checkpoint exists and no job is currently running it. */
    canResume: !mine && !!checkpoint && checkpoint.status !== "done",
    hasSeries: !!seriesId,
    analyze,
    reanalyze,
    resume,
  };
}
