/**
 * Series management on top of the positional db.ts API (Phase 5 Step B).
 *
 * Used by the import flow's series-assign step: a picked book can become a
 * standalone 1-vol series (default, same as before), start a brand-new named
 * series, or join an existing one as volume N — feeding the accumulative
 * knowledge base (deltaExtractor/kbRunner) across volumes.
 */
import {
  getAllSeries,
  insertBookSeries,
  insertSeries,
  removeBookSeriesLinks,
  updateSeriesVolumeCount,
} from "./db";

export interface SeriesCandidate {
  id: string;
  name: string;
  /** Volumes imported so far (max volume number seen). */
  volumeCount: number;
  /** Suggested volume number for the next book added to this series. */
  nextVolume: number;
}

export function createSeries(name: string): string {
  return insertSeries(name.trim());
}

/**
 * Link a book to a series as the given volume. Replaces any previous series
 * link (a book lives in exactly one series in this app).
 */
export function assignBookToSeries(
  bookId: string,
  seriesId: string,
  volumeNumber: number,
): void {
  removeBookSeriesLinks(bookId);
  insertBookSeries(bookId, seriesId, volumeNumber);
  updateSeriesVolumeCount(seriesId, volumeNumber);
}

/** All series a new import could join, most recently touched first. */
export function getSeriesCandidates(): SeriesCandidate[] {
  return getAllSeries().map((s) => ({
    id: s.id,
    name: s.name,
    volumeCount: s.totalVolumesImported,
    nextVolume: s.totalVolumesImported + 1,
  }));
}
