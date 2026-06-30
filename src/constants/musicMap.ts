/**
 * Tag → background-music mapping.
 *
 * MUSIC_MAP maps a mood/genre tag to candidate MP3 filenames. MUSIC_SOURCES
 * maps each filename to its bundled asset via `require()` (Metro needs literal
 * require() calls — you cannot build the path dynamically).
 *
 * ⏸️ MP3 assets are not bundled yet (see docs/PROGRESS.md). Until ~20-30
 * royalty-free loops are dropped into assets/music/, MUSIC_SOURCES stays empty
 * and music.ts no-ops gracefully. Add a `require()` line here per file as they
 * land, e.g.:
 *
 *   "battle_epic.mp3": require("../../assets/music/battle_epic.mp3"),
 */
export const MUSIC_MAP: Record<string, string[]> = {
  action: ["battle_epic.mp3", "intense_fight.mp3"],
  romance: ["soft_piano.mp3", "acoustic_gentle.mp3"],
  mystery: ["dark_ambient.mp3", "suspense.mp3"],
  thriller: ["dark_ambient.mp3", "suspense.mp3"],
  fantasy: ["orchestral_magic.mp3", "ethereal.mp3"],
  adventure: ["orchestral_magic.mp3", "ethereal.mp3"],
  xianxia: ["chinese_erhu.mp3", "cultivation_ambient.mp3"],
  cultivation: ["chinese_erhu.mp3", "cultivation_ambient.mp3"],
  wuxia: ["guqin_battle.mp3", "ancient_china.mp3"],
  scifi: ["electronic_ambient.mp3", "synthwave_soft.mp3"],
  comedy: ["light_ukulele.mp3", "cheerful_acoustic.mp3"],
  sad: ["melancholy_piano.mp3", "emotional_strings.mp3"],
  horror: ["creepy_ambient.mp3", "dark_tension.mp3"],
  "slice-of-life": ["lofi_chill.mp3", "cozy_cafe.mp3"],
};

/**
 * Filename → bundled asset module. Empty until MP3s are added (see above).
 * `any` is the type `require()` returns for static assets in RN.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MUSIC_SOURCES: Record<string, any> = {
  // "battle_epic.mp3": require("../../assets/music/battle_epic.mp3"),
};
