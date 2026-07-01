/**
 * Read-side of the series knowledge base (see docs/PROGRESS.md Phase 5).
 * Composes the series-scoped tables into one object for the UI. Writes happen
 * in `deltaExtractor.ts`; this module is read-only.
 */
import {
  getCharacters,
  getPowerStages,
  getWorldLore,
  type Character,
  type PowerStage,
  type WorldLore,
} from "./db";

export interface SeriesKB {
  powerStages: PowerStage[];
  characters: Character[];
  lore: WorldLore[];
}

/** Assemble a series' knowledge base (power tiers ordered by rank, characters, lore). */
export function getSeriesKB(seriesId: string): SeriesKB {
  return {
    powerStages: getPowerStages(seriesId), // getPowerStages already ORDER BY rank ASC
    characters: getCharacters(seriesId),
    lore: getWorldLore(seriesId),
  };
}

/** True when the series has no extracted knowledge yet (nothing to show). */
export function isKBEmpty(kb: SeriesKB): boolean {
  return kb.powerStages.length === 0 && kb.characters.length === 0 && kb.lore.length === 0;
}
