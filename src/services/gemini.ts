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
 * Closed tag vocabulary. Intentionally identical to the keys of MUSIC_MAP so a
 * book's AI tags map straight onto background music with no translation layer.
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
] as const;

export type BookTag = (typeof ALLOWED_TAGS)[number];

/** Raised for any Gemini call failure so callers can show a clean message. */
export class GeminiError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GeminiError";
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
 */
async function callGemini(prompt: string): Promise<string> {
  const now = Date.now();
  const ready = MODELS.filter((id) => (cooldownUntil.get(id) ?? 0) <= now);
  // Prefer ready models; keep cooling ones as a last resort rather than giving up.
  const order = ready.length > 0 ? ready : [...MODELS];
  const fullPrompt = `${SYSTEM_CONTEXT}\n\n${prompt}`;

  let lastError: unknown;
  for (const id of order) {
    try {
      const result = await getModel(id).generateContent(fullPrompt);
      cooldownUntil.delete(id); // recovered — clear any stale cooldown
      return result.response.text();
    } catch (e) {
      lastError = e;
      const cooldown = cooldownForStatus(httpStatus(e));
      if (cooldown === null) {
        throw new GeminiError("Gemini request failed.", e); // non-retryable: bail
      }
      cooldownUntil.set(id, Date.now() + cooldown); // rate-limited/down: try next
    }
  }
  throw new GeminiError("All Gemini models are rate-limited or unavailable.", lastError);
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
Return raw JSON only, e.g. ["action", "fantasy", "cultivation"].

Text:
${textSample}
`.trim();

  const parsed = extractJson<unknown>(await callGemini(prompt));
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
