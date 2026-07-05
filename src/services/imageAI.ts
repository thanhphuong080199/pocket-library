/**
 * Free AI images via Pollinations.ai (Phase 6). No API key, no package —
 * an image IS its URL: https://image.pollinations.ai/prompt/<encoded>?...
 *
 * Flow: Vietnamese source text (title/tags, character appearance) → one Gemini
 * call condenses/translates it into a short English scene prompt (image models
 * handle English best; falls back to the raw text when no key) → deterministic
 * Pollinations URL. Callers persist the URL forever (books.coverUrl,
 * characters.imageUrl, character_events.imageUrl) — cache-first, like all AI.
 *
 * Consistency: every character gets a stable seed derived from their id, and
 * stage portraits reuse the SAME seed + a shared base description, which is the
 * best face-consistency lever a stateless prompt→image URL service offers.
 */
import { pickStyleTag, styleForGenre } from "@/src/constants/styleMap";
import type { Book, Character, CharacterEvent, Location } from "./db";
import { isGeminiConfigured, runPrompt } from "./gemini";

const BASE = "https://image.pollinations.ai/prompt/";

export interface ImageOptions {
  width?: number;
  height?: number;
  seed?: number;
}

/** Deterministic Pollinations URL for a finished English prompt. */
export function pollinationsUrl(prompt: string, opts: ImageOptions = {}): string {
  const { width = 400, height = 600, seed } = opts;
  const params = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: "true",
  });
  if (seed != null) params.set("seed", String(seed));
  return `${BASE}${encodeURIComponent(prompt)}?${params.toString()}`;
}

/** Stable positive seed from an id (djb2) — same character, same face. */
export function seedFromId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h % 1_000_000;
}

/**
 * Translate/condense Vietnamese source text into a short English image prompt.
 * Soft-fails to the raw text when Gemini is unavailable — Pollinations copes
 * with Vietnamese, just less reliably.
 */
async function toEnglishPrompt(instruction: string, source: string): Promise<string> {
  if (!isGeminiConfigured()) return source;
  try {
    const out = await runPrompt(
      `${instruction}\n\nNguồn (tiếng Việt):\n${source}\n\n` +
        `Trả về DUY NHẤT câu prompt tiếng Anh, dưới 60 từ, không giải thích, không markdown.`,
    );
    const line = out.trim().replace(/^["'`]+|["'`]+$/g, "");
    return line || source;
  } catch {
    return source; // image is a nice-to-have; never block on the translate step
  }
}

/**
 * AI cover for a book without one. Scene comes from the title + tags; style
 * from the first tag (STYLE_MAP). Persist via db.updateBookCover.
 */
export async function generateCoverUrl(book: Book): Promise<string> {
  const scene = await toEnglishPrompt(
    "Viết một prompt tiếng Anh tả CẢNH minh hoạ bìa sách cho truyện này (không chữ, không tiêu đề trong ảnh). Dựa vào tên truyện và thể loại để tưởng tượng khung cảnh tiêu biểu.",
    `Tên truyện: ${book.title}${book.tags.length ? `\nThể loại: ${book.tags.join(", ")}` : ""}`,
  );
  const prompt = `book cover illustration, ${scene}, ${styleForGenre(pickStyleTag(book.tags))}, no text`;
  return pollinationsUrl(prompt, { width: 400, height: 600, seed: seedFromId(book.id) });
}

/**
 * Base English description of a character's current form, framing-neutral so it
 * can drive either a head-and-shoulders portrait or a full-body illustration.
 */
async function characterScene(c: Character, appearanceVi: string): Promise<string> {
  const bits = [
    `Tên: ${c.name}`,
    c.gender ? `Giới tính: ${c.gender}` : "",
    appearanceVi ? `Ngoại hình: ${appearanceVi}` : "",
    c.faction ? `Thế lực/bối cảnh: ${c.faction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return toEnglishPrompt(
    "Viết một prompt tiếng Anh tả ngoại hình nhân vật này. QUAN TRỌNG: căn cứ vào ngoại hình/chủng " +
      "loài được mô tả để xác định nhân vật có phải con người hay không. Nếu KHÔNG phải con người " +
      "(thú, yêu thú, linh thú, rồng, quái vật, robot, tinh linh… hay bất kỳ loài phi nhân nào), hãy " +
      "khắc hoạ ĐÚNG là sinh vật/loài đó và nêu rõ ở đầu prompt (ví dụ 'a giant white tiger', 'a nine-" +
      "tailed fox'), TUYỆT ĐỐI không vẽ thành người. Nếu là con người thì tả đặc điểm khuôn mặt, cơ " +
      "thể, trang phục nổi bật. Không nêu tên riêng trong prompt.",
    bits,
  );
}

/**
 * Canonical portrait (head + upper body) from the character's CURRENT
 * appearance. Persist via db.updateCharacterImage. `styleTag` = a book/series
 * tag for the art style (see pickStyleTag).
 */
export async function generateCharacterPortraitUrl(
  c: Character,
  styleTag?: string,
): Promise<string> {
  const scene = await characterScene(c, c.appearance ?? "");
  const prompt = `character portrait, head and shoulders, ${scene}, ${styleForGenre(styleTag)}`;
  return pollinationsUrl(prompt, { width: 400, height: 600, seed: seedFromId(c.id) });
}

/**
 * Full-body standing illustration from the character's CURRENT appearance —
 * taller canvas, head to toe. Same seed as the portrait so it reads as the same
 * character. Persist via db.updateCharacterFullBody. `styleTag` = a book/series
 * tag for the art style (see pickStyleTag).
 */
export async function generateCharacterFullBodyUrl(
  c: Character,
  styleTag?: string,
): Promise<string> {
  const scene = await characterScene(c, c.appearance ?? "");
  const prompt =
    `full body character illustration, standing, full figure head to toe, ` +
    `${scene}, ${styleForGenre(styleTag)}`;
  return pollinationsUrl(prompt, { width: 400, height: 720, seed: seedFromId(c.id) });
}

/**
 * Stage portrait for an `appearance_change` event — the event description IS
 * the complete physical description of that life stage. Uses the character's
 * seed so the face stays as consistent as the service allows. Persist via
 * db.updateCharacterEventImage.
 */
export async function generateStagePortraitUrl(
  c: Character,
  event: CharacterEvent,
  styleTag?: string,
): Promise<string> {
  const scene = await characterScene(c, event.description);
  const prompt = `character portrait, head and shoulders, ${scene}, ${styleForGenre(styleTag)}`;
  return pollinationsUrl(prompt, { width: 400, height: 600, seed: seedFromId(c.id) });
}

/**
 * Scenery illustration for a KB location — synchronous, no Gemini call: the
 * extractor already wrote an ENGLISH `visualPrompt` per location (see
 * deltaExtractor.ts), so unlike covers/portraits there is no translate step.
 * Falls back to the Vietnamese name + description for rows that predate the
 * field. Landscape 16:9; seeded by id so the place looks the same forever.
 */
export function locationImageUrl(l: Location, styleTag?: string): string {
  if (l.imageUrl) return l.imageUrl;
  const scene = l.visualPrompt?.trim() || [l.name, l.description].filter(Boolean).join(", ");
  const prompt = `${scene}, ${styleForGenre(styleTag)}, scenery, wide shot, no people, no text`;
  return pollinationsUrl(prompt, { width: 800, height: 450, seed: seedFromId(l.id) });
}
