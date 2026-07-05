/**
 * Genre/tag → Pollinations.ai style prompt fragment (English — image models
 * handle English best; Vietnamese descriptions are translated before use).
 */
export const STYLE_MAP: Record<string, string> = {
  "light novel": "manga and anime art style, clean cel-shaded lineart, expressive eyes, vibrant",
  manga: "manga and anime art style, clean cel-shaded lineart, expressive eyes, vibrant",
  anime: "manga and anime art style, clean cel-shaded lineart, expressive eyes, vibrant",
  xianxia: "chinese fantasy xianxia cultivation style, dramatic lighting, detailed armor",
  wuxia: "wuxia martial arts style, ancient chinese setting, ink painting aesthetic",
  cultivation: "eastern cultivation fantasy, flowing robes, spiritual energy, epic",
  fantasy: "western high fantasy art, epic illustration, detailed environment",
  romance: "soft anime style, shoujo art, warm pastel colors",
  scifi: "cyberpunk futuristic style, neon lighting, technological",
  mystery: "noir style, dark moody atmosphere, cinematic",
  thriller: "tense cinematic thriller, dramatic shadows, high contrast",
  horror: "dark gothic horror, eerie atmosphere, dramatic shadows",
  adventure: "epic adventure illustration, sweeping landscapes, vivid color",
  action: "dynamic action scene, motion, dramatic composition",
  comedy: "bright cheerful cartoon style, playful, vivid colors",
  sad: "melancholic muted palette, soft lighting, emotional",
  "slice-of-life": "cozy anime style, warm lighting, everyday setting",
};

export const DEFAULT_STYLE = "digital art, detailed illustration";

export function styleForGenre(genreOrTag?: string): string {
  if (!genreOrTag) return DEFAULT_STYLE;
  return STYLE_MAP[genreOrTag.toLowerCase()] ?? DEFAULT_STYLE;
}

/**
 * Tags that dictate an *overriding* art style no matter where they sit in the
 * tag list — e.g. a "Light Novel" (Japanese) book should render manga/anime
 * regardless of its genre tags. Lower-cased for matching.
 */
const PRIORITY_STYLE_TAGS = ["light novel", "manga", "anime"];

/**
 * Pick the tag that should drive the art style for a book/series. A priority
 * tag (manga/anime style) wins wherever it appears; otherwise the first tag —
 * matching the old `tags[0]` behaviour. Feed the result to `styleForGenre`.
 */
export function pickStyleTag(tags?: string[]): string | undefined {
  if (!tags?.length) return undefined;
  const priority = tags.find((t) => PRIORITY_STYLE_TAGS.includes(t.toLowerCase()));
  return priority ?? tags[0];
}
