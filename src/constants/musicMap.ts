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
 * Filename → bundled asset module. Metro requires literal `require()` calls, so
 * every file in assets/music/ is listed explicitly below. All loops are ≤90s,
 * mono, 96kbps (compressed at build-prep time — see docs/PROGRESS.md).
 * The value type mirrors what `require()` returns for a static asset in RN.
 */
export const MUSIC_SOURCES: Record<string, number> = {
  "acoustic_gentle.mp3": require("../../assets/music/acoustic_gentle.mp3"),
  "ancient_china.mp3": require("../../assets/music/ancient_china.mp3"),
  "battle_epic.mp3": require("../../assets/music/battle_epic.mp3"),
  "cheerful_acoustic.mp3": require("../../assets/music/cheerful_acoustic.mp3"),
  "chinese_erhu.mp3": require("../../assets/music/chinese_erhu.mp3"),
  "cozy_cafe.mp3": require("../../assets/music/cozy_cafe.mp3"),
  "creepy_ambient.mp3": require("../../assets/music/creepy_ambient.mp3"),
  "cultivation_ambient.mp3": require("../../assets/music/cultivation_ambient.mp3"),
  "dark_ambient.mp3": require("../../assets/music/dark_ambient.mp3"),
  "dark_tension.mp3": require("../../assets/music/dark_tension.mp3"),
  "electronic_ambient.mp3": require("../../assets/music/electronic_ambient.mp3"),
  "emotional_strings.mp3": require("../../assets/music/emotional_strings.mp3"),
  "ethereal.mp3": require("../../assets/music/ethereal.mp3"),
  "guqin_battle.mp3": require("../../assets/music/guqin_battle.mp3"),
  "intense_fight.mp3": require("../../assets/music/intense_fight.mp3"),
  "light_ukulele.mp3": require("../../assets/music/light_ukulele.mp3"),
  "lofi_chill.mp3": require("../../assets/music/lofi_chill.mp3"),
  "melancholy_piano.mp3": require("../../assets/music/melancholy_piano.mp3"),
  "orchestral_magic.mp3": require("../../assets/music/orchestral_magic.mp3"),
  "soft_piano.mp3": require("../../assets/music/soft_piano.mp3"),
  "suspense.mp3": require("../../assets/music/suspense.mp3"),
  "synthwave_soft.mp3": require("../../assets/music/synthwave_soft.mp3"),
};
