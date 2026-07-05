/**
 * Gemini Flash client — the app's only cloud dependency.
 *
 * Principles (see CLAUDE.md):
 * - **Free tier only.** `gemini-3.5-flash` is free (~15 RPM / 1500 req-per-day,
 *   resets midnight Pacific, per-project). NOTE: Gemini 1.0/1.5 were shut down
 *   in 2026 (requests 404) and Pro models are now paid-only — Flash stays free.
 *   Swap the head of `MODELS` below if this changes; `gemini-flash-latest` self-heals.
 * - **Model fallback.** Free quotas are per-model, so on a rate-limit (429) or
 *   server error (500/503) we transparently fall through `MODELS` to the next
 *   free Flash — each has its own quota bucket. Rate-limited models get a short
 *   cooldown so later calls skip them. Non-retryable errors (bad key/prompt)
 *   surface immediately; switching models wouldn't help.
 * - **Cache forever.** Callers MUST check `ai_cache` (db.ts) before calling in;
 *   this module is stateless and does no caching itself.
 * - **Raw JSON, no fences.** Prompts demand bare JSON, but the model sometimes
 *   wraps it in ```json fences anyway — `extractJson` strips them defensively.
 * - **Vietnamese-first.** `SYSTEM_CONTEXT` is prepended to every prompt so the
 *   model preserves Hán Việt names instead of translating to Mandarin/pinyin.
 *
 * The API key (`EXPO_PUBLIC_GEMINI_KEY`) is public-by-design — it is bundled
 * into the client JS. Missing key is a soft failure: `isGeminiConfigured()`
 * returns false and features stay dormant rather than crashing the app.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Free Flash models in preference order. On a retryable failure we fall through
 * to the next. All are free-tier and share the closed-JSON contract of the
 * prompts; later entries trade a little quality for a separate quota bucket.
 */
const MODELS = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.1-flash-lite"] as const;

/** Prepended to every prompt. Keeps output in Vietnamese with Hán Việt intact. */
const SYSTEM_CONTEXT = `
You are analyzing Vietnamese web novels and books.
- Input text is in Vietnamese.
- Always respond in Vietnamese.
- Character names may be Sino-Vietnamese (Hán Việt), e.g. "Tiêu Viêm", "Đường Tam".
- Power-system terms are often transliterated Chinese: "Đấu Khí", "Võ Hoàng", "Thánh".
- Return all JSON string values in Vietnamese unless they are proper nouns.
`.trim();

/**
 * Closed tag vocabulary. Most entries mirror the keys of MUSIC_MAP so a book's
 * AI tags map straight onto background music with no translation layer. The
 * exception is "light novel", a *format* tag (not a mood): it has no MUSIC_MAP
 * entry — music.ts simply ignores tags it doesn't recognize — but it drives the
 * manga/anime art style via STYLE_MAP/pickStyleTag.
 */
export const ALLOWED_TAGS = [
  "action",
  "romance",
  "mystery",
  "fantasy",
  "scifi",
  "comedy",
  "sad",
  "horror",
  "adventure",
  "cultivation",
  "wuxia",
  "xianxia",
  "thriller",
  "slice-of-life",
  "light novel",
] as const;

export type BookTag = (typeof ALLOWED_TAGS)[number];

/**
 * Vietnamese display labels for tags. The stored tag keys stay English because
 * they double as MUSIC_MAP keys (see ALLOWED_TAGS) — this map is display-only,
 * so the UI can show localized genre/mood names without touching the key space.
 */
export const TAG_LABELS_VI: Record<BookTag, string> = {
  action: "Hành động",
  romance: "Lãng mạn",
  mystery: "Bí ẩn",
  fantasy: "Kỳ ảo",
  scifi: "Khoa học viễn tưởng",
  comedy: "Hài hước",
  sad: "Bi thương",
  horror: "Kinh dị",
  adventure: "Phiêu lưu",
  cultivation: "Tu luyện",
  wuxia: "Võ hiệp",
  xianxia: "Tiên hiệp",
  thriller: "Giật gân",
  "slice-of-life": "Đời thường",
  "light novel": "Light Novel",
};

/** Raised for any Gemini call failure so callers can show a clean message. */
export class GeminiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GeminiError";
  }
}

/**
 * Every free model is in rate-limit cooldown right now. Distinct from a generic
 * failure so long-running jobs (the KB pass) can *pause and resume* after the
 * cooldown instead of aborting. Check `nextModelReadyInMs()` for when to retry.
 */
export class GeminiRateLimitError extends GeminiError {
  constructor(cause?: unknown) {
    super("All Gemini models are rate-limited.", cause);
    this.name = "GeminiRateLimitError";
  }
}

/** Options for a single call (used by the KB delta pass for large JSON output). */
export interface RunOptions {
  /** Force `application/json` response — bare, parseable JSON, no fences. */
  json?: boolean;
  /** Raise the output cap so big deltas don't truncate mid-JSON. */
  maxOutputTokens?: number;
  /** Abort the in-flight request (e.g. user cancels a long KB pass). */
  signal?: AbortSignal;
}

/** Raised when a request was aborted via `RunOptions.signal` (e.g. user cancel). */
export class GeminiAbortError extends GeminiError {
  constructor(cause?: unknown) {
    super("Gemini request was cancelled.", cause);
    this.name = "GeminiAbortError";
  }
}

// ---------------------------------------------------------------------------
// Client (lazy singleton)
// ---------------------------------------------------------------------------

/** How long to skip a model after it fails, by failure kind. */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60_000; // 429: likely a per-minute/day cap
const SERVER_ERROR_COOLDOWN_MS = 30_000; //   5xx/network: usually transient

let genAI: GoogleGenerativeAI | null = null;
const modelCache = new Map<string, ReturnType<GoogleGenerativeAI["getGenerativeModel"]>>();
/** modelId → epoch ms until which we skip it (set after a retryable failure). */
const cooldownUntil = new Map<string, number>();

function apiKey(): string {
  const key = process.env.EXPO_PUBLIC_GEMINI_KEY?.trim();
  // The .env.example placeholder counts as "not configured".
  if (!key || key === "your_gemini_api_key_here") return "";
  return key;
}

/** True when a usable key is present. Gate AI UI on this. */
export function isGeminiConfigured(): boolean {
  return apiKey().length > 0;
}

function getModel(id: string) {
  const cached = modelCache.get(id);
  if (cached) return cached;
  const key = apiKey();
  if (!key) throw new GeminiError("Gemini API key is not set (EXPO_PUBLIC_GEMINI_KEY).");
  genAI ??= new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: id });
  modelCache.set(id, model);
  return model;
}

/** Pull an HTTP status out of an SDK error (property, else parsed from message). */
function httpStatus(e: unknown): number | undefined {
  if (e && typeof e === "object") {
    const status = (e as { status?: unknown }).status;
    if (typeof status === "number") return status;
    const message = (e as { message?: unknown }).message;
    if (typeof message === "string") {
      const m = message.match(/\b(4\d\d|5\d\d)\b/);
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

/**
 * Retryable = worth trying a *different* model:
 *  - 429 rate limit / quota (each model has its own free bucket)
 *  - 500/503 server errors, and network failures (no status)
 * NOT retryable: 400 (bad prompt), 401/403 (bad/missing key) — a bug on our
 * side; another model would fail identically, so surface it.
 */
function cooldownForStatus(status: number | undefined): number | null {
  if (status === 429) return RATE_LIMIT_COOLDOWN_MS;
  if (status === undefined || status === 500 || status === 503) return SERVER_ERROR_COOLDOWN_MS;
  return null; // non-retryable
}

/**
 * Run a prompt (system context prepended) against the first available model,
 * falling through MODELS on retryable failures. Models in cooldown are tried
 * last (only if every model is cooling down do we bother them again).
 *
 * Exported as the low-level runner so other services (e.g. the KB delta
 * extractor) reuse the model-fallback + Vietnamese-context plumbing instead of
 * spinning up a second client.
 */
export async function runPrompt(prompt: string, opts?: RunOptions): Promise<string> {
  const now = Date.now();
  const ready = MODELS.filter((id) => (cooldownUntil.get(id) ?? 0) <= now);
  // Prefer ready models; keep cooling ones as a last resort rather than giving up.
  const order = ready.length > 0 ? ready : [...MODELS];
  const fullPrompt = `${SYSTEM_CONTEXT}\n\n${prompt}`;

  const generationConfig =
    opts?.json || opts?.maxOutputTokens
      ? {
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
          ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
        }
      : undefined;
  const request = generationConfig
    ? { contents: [{ role: "user", parts: [{ text: fullPrompt }] }], generationConfig }
    : fullPrompt;
  const requestOptions = opts?.signal ? { signal: opts.signal } : undefined;

  let lastError: unknown;
  let sawRateLimit = false;
  for (const id of order) {
    try {
      const result = await getModel(id).generateContent(request, requestOptions);
      cooldownUntil.delete(id); // recovered — clear any stale cooldown
      return result.response.text();
    } catch (e) {
      lastError = e;
      // A user-triggered abort must NOT fall through to other models — bail now.
      if (opts?.signal?.aborted || (e as { name?: string })?.name === "AbortError") {
        throw new GeminiAbortError(e);
      }
      const status = httpStatus(e);
      const cooldown = cooldownForStatus(status);
      if (cooldown === null) {
        throw new GeminiError("Gemini request failed.", e); // non-retryable: bail
      }
      if (status === 429) sawRateLimit = true;
      cooldownUntil.set(id, Date.now() + cooldown); // rate-limited/down: try next
    }
  }
  // Distinguish "everything is rate-limited" (pause + resume) from a transient
  // server outage — either way we exhausted the models this round.
  throw sawRateLimit
    ? new GeminiRateLimitError(lastError)
    : new GeminiError("All Gemini models are unavailable.", lastError);
}

/**
 * Milliseconds until at least one model is out of cooldown (0 if one is ready
 * now). Lets a paused job schedule its own resume after a rate-limit.
 */
export function nextModelReadyInMs(): number {
  const now = Date.now();
  let min = Infinity;
  for (const id of MODELS) {
    min = Math.min(min, Math.max(0, (cooldownUntil.get(id) ?? 0) - now));
  }
  return min === Infinity ? 0 : min;
}

// ---------------------------------------------------------------------------
// JSON parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse JSON from a model reply, tolerating markdown fences and stray prose.
 * Strips ```json / ``` fences, then falls back to slicing the first {...} or
 * [...] block if the model wrapped the JSON in explanation.
 */
export function extractJson<T>(raw: string): T {
  let s = raw.trim();

  // Strip a ```json ... ``` (or plain ```) fence if present.
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s) as T;
  } catch {
    // Fall back to the first balanced-looking object/array in the string.
    const start = s.search(/[[{]/);
    const end = Math.max(s.lastIndexOf("]"), s.lastIndexOf("}"));
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new GeminiError(`Could not parse JSON from Gemini reply: ${raw.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/**
 * Auto-tag a book from a text sample. Returns up to 4 tags drawn ONLY from
 * ALLOWED_TAGS (invalid/hallucinated tags are dropped), deduped, lowercased.
 * May return `[]` if the model gives nothing usable — callers decide what to do.
 */
export async function generateTags(textSample: string): Promise<BookTag[]> {
  const prompt = `
Read this story excerpt and return ONLY a JSON array of mood/genre tags.
Choose strictly from this list: ${ALLOWED_TAGS.join(", ")}.
Use at most 4 tags, most relevant first. Do not invent tags outside the list.

Note on "light novel": this is a FORMAT tag for Japanese-style light novels (or
works written in that style) — signs include Japanese character/place names,
isekai/reincarnation premises, high-school or academy settings, RPG-like status
screens/skills, and a breezy dialogue-heavy narration. Add "light novel"
alongside the genre/mood tags whenever the excerpt reads like one; it is NOT a
substitute for the mood tags.

Return raw JSON only, e.g. ["light novel", "action", "fantasy"].

Text:
${textSample}
`.trim();

  const parsed = extractJson<unknown>(await runPrompt(prompt));
  if (!Array.isArray(parsed)) return [];

  const allowed = new Set<string>(ALLOWED_TAGS);
  const seen = new Set<string>();
  const tags: BookTag[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const tag = item.trim().toLowerCase();
    if (allowed.has(tag) && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag as BookTag);
    }
    if (tags.length >= 4) break;
  }
  return tags;
}

/**
 * Generate a short Vietnamese story summary from a text sample (opening premise,
 * world/setting, tone). Plain text — no JSON. Returns a trimmed string; may be
 * empty if the model gives nothing usable.
 */
export async function generateSummary(textSample: string): Promise<string> {
  const prompt = `
Read this story excerpt and write a concise Vietnamese summary of the book so far.
Cover: the premise/main conflict, the setting/world-building, and the overall tone.
Write 2-4 short paragraphs in Vietnamese. Do NOT spoil major twists or the ending.
Return plain text only — no markdown, no headings, no JSON.

Text:
${textSample}
`.trim();

  return (await runPrompt(prompt)).trim();
}

// Deep power-system + character extraction moved to the unified KB engine
// (`src/services/deltaExtractor.ts`), which reads the whole book (chunked) and
// writes structured data into the series-scoped tables. See docs/PROGRESS.md
// Phase 5. `runPrompt` + `extractJson` above are the shared primitives it uses.

/**
 * Explain a word/phrase in the context of a passage. Returns a short (≤3
 * sentence) Vietnamese explanation as plain text.
 */
export async function explainWord(word: string, context: string): Promise<string> {
  const prompt = `
In the context of this story passage, briefly explain the meaning of the word or
phrase "${word}". Answer in Vietnamese, under 3 sentences, simple language. Plain
text only.

Passage: "${context}"
`.trim();

  return (await runPrompt(prompt)).trim();
}
