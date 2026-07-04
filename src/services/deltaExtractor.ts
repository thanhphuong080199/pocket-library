/**
 * Accumulative Knowledge Base engine (see docs/PROGRESS.md Phase 5).
 *
 * Reads a whole book (chunked) and grows a **per-series** knowledge base —
 * power-system tiers, characters (structured), and world lore — in the
 * series-scoped SQLite tables. It's the single engine behind both the Phase-4
 * "analyze full book" depth feature and Phase-5 multi-volume accumulation.
 *
 * How it stays cheap:
 * - **Delta extraction.** Each chunk is analyzed against the *existing* KB; the
 *   model is asked to return only what's NEW. Across volumes / re-runs this
 *   avoids re-extracting known facts.
 * - **Large chunks.** The dominant cost is one Gemini call per chunk, so we use
 *   big chunks (`CHUNK_CHARS`) to minimize the call count on a first read.
 * - **Shared client.** Routes through `gemini.runPrompt` (model fallback +
 *   Vietnamese system context) and `gemini.extractJson` (fence-tolerant parse);
 *   no second client.
 *
 * Everything is synchronous SQLite except the Gemini calls, which run
 * sequentially (a parallel burst would trip the free-tier per-minute cap).
 */
import {
  findCharacter,
  findLocation,
  getCharacter,
  getCharacters,
  getLocations,
  getPowerStages,
  getWorldLore,
  insertCharacter,
  insertCharacterEvent,
  insertLocation,
  insertPowerStage,
  insertWorldLore,
  updateCharacter,
  updateLocation,
  type CharacterEventType,
  type Relationship,
} from "./db";
import { extractJson, GeminiAbortError, GeminiRateLimitError, runPrompt } from "./gemini";

/**
 * Target chunk size. Deliberately large: the dominant cost is ~one Gemini
 * request per chunk, and the free tier caps *requests per minute* (~10–15), so
 * fewer/bigger requests is the main defense against rate-limiting a big book.
 * Flash's context easily holds this; JSON output mode + a raised token cap
 * (see `extractDelta`) keep the larger delta from truncating.
 */
const CHUNK_CHARS = 300_000;
/** Output cap for the delta — large enough for many characters/events at once. */
const DELTA_MAX_OUTPUT_TOKENS = 16_384;
/** If a chunk's JSON won't parse (usually truncated output), split + retry down to this size. */
const MIN_SPLIT_CHARS = 20_000;
const MAX_SPLIT_DEPTH = 4;

const EVENT_TYPES: CharacterEventType[] = [
  "power_up",
  "relationship",
  "death",
  "reveal",
  "appearance_change",
  "other",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Compact snapshot fed into the prompt so the model can skip known facts. */
export interface KBSnapshot {
  powerStages: { name: string; rank: number; description: string }[];
  characters: { name: string; aliases: string[]; currentPower: string; faction: string }[];
  lore: string[];
  /** Known location names only — enough for the model to skip re-reporting them. */
  locations: string[];
}

interface DeltaPowerStage {
  name: string;
  rank: number;
  description: string;
}

interface DeltaCharacter {
  name: string;
  gender?: string;
  role?: string;
  /** New/updated current realm/level. */
  powerChange?: string;
  faction?: string;
  aliases?: string[];
  appearance?: string;
  personality?: string;
  backstory?: string;
  status?: string;
  newSkills?: string[];
  newRelationships?: Relationship[];
  /** What happened to them in this chunk (logged to character_events). */
  event?: string;
  eventType?: CharacterEventType;
  /**
   * Full new physical description when the character's FORM fundamentally
   * changes (life stage, transformation, permanent injury) — NOT outfits.
   * Snapshots each stage into character_events (type appearance_change) so
   * stage portraits can be generated later; also overwrites `appearance`.
   */
  appearanceChange?: string;
}

interface DeltaLocation {
  name: string;
  /** Vietnamese kind: 'thành phố' | 'tông môn' | 'bí cảnh' | … */
  type?: string;
  description?: string;
  significance?: string;
  /** English scene description for the image AI (see imageAI.ts). */
  visualPrompt?: string;
}

interface Delta {
  hasChanges: boolean;
  newPowerStages?: DeltaPowerStage[];
  updatedCharacters?: DeltaCharacter[];
  newLocations?: DeltaLocation[];
  newLore?: string;
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

export interface BookChunk {
  text: string;
  /** Index of the first chapter in this chunk (for event/stage provenance). */
  startChapter: number;
}

/**
 * Group a book's per-chapter text into large chunks on chapter boundaries. A
 * single chapter larger than `maxChars` becomes its own (oversized) chunk
 * rather than being split mid-chapter.
 */
export function chunkChapters(chapters: string[], maxChars = CHUNK_CHARS): BookChunk[] {
  const chunks: BookChunk[] = [];
  let buf = "";
  let start = 0;

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i] ?? "";
    if (buf && buf.length + ch.length > maxChars) {
      chunks.push({ text: buf, startChapter: start });
      buf = "";
      start = i;
    }
    buf = buf ? `${buf}\n\n${ch}` : ch;
  }
  if (buf.trim()) chunks.push({ text: buf, startChapter: start });
  return chunks;
}

// ---------------------------------------------------------------------------
// KB snapshot
// ---------------------------------------------------------------------------

export function loadSnapshot(seriesId: string): KBSnapshot {
  return {
    powerStages: getPowerStages(seriesId).map((s) => ({
      name: s.stageName,
      rank: s.rank,
      description: s.description,
    })),
    characters: getCharacters(seriesId).map((c) => ({
      name: c.name,
      aliases: c.aliases,
      currentPower: c.currentPower ?? "",
      faction: c.faction ?? "",
    })),
    lore: getWorldLore(seriesId).map((l) => l.content),
    locations: getLocations(seriesId).map((l) => l.name),
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function buildPrompt(existingKB: KBSnapshot, chunkText: string, volumeNumber: number): string {
  return `
You are maintaining a structured knowledge base for a story, in Vietnamese.

EXISTING KNOWLEDGE BASE (already known — do NOT repeat anything already here):
${JSON.stringify(existingKB, null, 1)}

NEW TEXT (volume ${volumeNumber}):
${chunkText}

Extract ONLY information that is NEW or CHANGED versus the existing knowledge base.
Be thorough and detailed — spoilers are fine, include late-story reveals.
Return ONLY valid JSON (no markdown, no prose) in exactly this shape:

{
  "hasChanges": boolean,
  "newPowerStages": [
    { "name": "tên cảnh giới", "rank": number, "description": "cách đo sức mạnh, cách đột phá, kỹ thuật tiêu biểu" }
  ],
  "updatedCharacters": [
    {
      "name": "tên nhân vật",
      "gender": "Nam | Nữ | Khác | ''",
      "role": "protagonist | antagonist | supporting",
      "powerChange": "cảnh giới / sức mạnh hiện tại",
      "faction": "thế lực / môn phái",
      "aliases": ["biệt danh"],
      "appearance": "ngoại hình",
      "personality": "tính cách",
      "backstory": "lai lịch / diễn biến quan trọng (có thể spoiler)",
      "status": "còn sống | đã chết | không rõ",
      "newSkills": ["kỹ năng / công pháp mới"],
      "newRelationships": [{ "name": "tên người liên quan", "relation": "người đó LÀ GÌ của nhân vật này" }],
      "event": "điều xảy ra với nhân vật trong đoạn này",
      "eventType": "power_up | relationship | death | reveal | other",
      "appearanceChange": "mô tả ngoại hình HOÀN CHỈNH mới, CHỈ khi hình dạng cơ thể thay đổi căn bản"
    }
  ],
  "newLocations": [
    {
      "name": "tên địa danh",
      "type": "thành phố | tông môn | học viện | quốc gia | bí cảnh | vùng đất | khác",
      "description": "mô tả địa danh",
      "significance": "vai trò của nơi này trong câu chuyện",
      "visualPrompt": "IN ENGLISH: a vivid one-sentence visual scene description of this place for an image generator — landscape, architecture, atmosphere, lighting"
    }
  ],
  "newLore": "thông tin thế giới / bối cảnh mới, hoặc null"
}

Rules:
- "rank" orders power tiers ascending (weakest = lowest number), continuing from any existing tiers.
- For each character, use their most complete CANONICAL name as "name" and put every other
  name/title/nickname in "aliases". If the character already exists in the knowledge base above
  (matching by name OR any alias), REUSE that exact existing "name" — do not create a variant.
- "role": the character's importance to the plot — "protagonist" (main), "antagonist", or
  "supporting" (minor/side).
- "newRelationships": ALWAYS record each relation from THIS character's point of view — the
  "relation" states what the NAMED person is TO this character. Example: in nhân vật A's list,
  { "name": "B", "relation": "vợ" } means B is A's wife; the reciprocal entry in nhân vật B's
  list is { "name": "A", "relation": "chồng" } (A is B's husband). Never store the relation from
  the other person's perspective.
- "appearanceChange": ONLY when the character's PHYSICAL FORM fundamentally changes — a new life
  stage (trẻ con → trưởng thành, lão hoá), a transformation (hoá thân, đổi thân thể, mọc
  cánh/sừng), or a permanent bodily change (mất chi, sẹo lớn, tóc bạc trắng). Give the COMPLETE
  new physical description, not just the difference. Do NOT report clothing, armor, accessories,
  or hairstyle changes — leave it null for those. First introductions go in "appearance", not here.
- "newLocations": only NOTABLE places — recurring or plot-important (cities, sects, academies,
  kingdoms, secret realms, battlegrounds). Skip one-off rooms/streets. Reuse the exact existing
  name if the place is already in the knowledge base above.
- "visualPrompt" MUST be written in English (it feeds an image generator); everything else stays
  in Vietnamese.
- Use "" / [] / null for anything the text does not reveal — never invent.
- All Vietnamese text; keep proper nouns (Hán Việt) intact.
- If there is genuinely nothing new, return { "hasChanges": false }.
`.trim();
}

async function extractDelta(
  existingKB: KBSnapshot,
  chunkText: string,
  volumeNumber: number,
  signal?: AbortSignal,
): Promise<Delta> {
  const raw = await runPrompt(buildPrompt(existingKB, chunkText, volumeNumber), {
    json: true,
    maxOutputTokens: DELTA_MAX_OUTPUT_TOKENS,
    signal,
  });
  const parsed = extractJson<Partial<Delta>>(raw);
  return {
    hasChanges: parsed.hasChanges !== false, // default to true unless explicitly false
    newPowerStages: cleanPowerStages(parsed.newPowerStages),
    updatedCharacters: cleanCharacters(parsed.updatedCharacters),
    newLocations: cleanLocations(parsed.newLocations),
    newLore: str(parsed.newLore) || undefined,
  };
}

// ---------------------------------------------------------------------------
// Merge into SQLite
// ---------------------------------------------------------------------------

function mergeDelta(
  seriesId: string,
  delta: Delta,
  snapshot: KBSnapshot,
  volumeNumber: number,
  chapterIndex: number,
): void {
  // Power stages — skip names already known (delta should exclude them, but be safe).
  const knownStages = new Set(snapshot.powerStages.map((s) => s.name.toLowerCase()));
  for (const stage of delta.newPowerStages ?? []) {
    if (knownStages.has(stage.name.toLowerCase())) continue;
    knownStages.add(stage.name.toLowerCase());
    insertPowerStage({
      seriesId,
      stageName: stage.name,
      rank: stage.rank,
      description: stage.description,
      subStages: [],
      discoveredAtVolume: volumeNumber,
      discoveredAtChapter: chapterIndex,
    });
    snapshot.powerStages.push(stage);
  }

  // Characters — resolve by name OR any alias (the model may refer to someone
  // by a nickname/title, or a resume may re-see them), then insert-or-enrich.
  for (const c of delta.updatedCharacters ?? []) {
    const canonical = resolveExistingName(snapshot, c);
    const id = canonical ? findCharacter(seriesId, canonical) : null;

    if (!id) {
      const newId = insertCharacter({
        seriesId,
        name: c.name,
        gender: c.gender,
        role: c.role,
        currentPower: c.powerChange,
        faction: c.faction,
        aliases: c.aliases,
        appearance: c.appearanceChange ?? c.appearance,
        personality: c.personality,
        backstory: c.backstory,
        status: c.status,
        skills: c.newSkills,
        relationships: c.newRelationships,
        lastSeenVolume: volumeNumber,
        lastSeenChapter: chapterIndex,
      });
      snapshot.characters.push({
        name: c.name,
        aliases: c.aliases ?? [],
        currentPower: c.powerChange ?? "",
        faction: c.faction ?? "",
      });
      if (c.event) logEvent(newId, seriesId, volumeNumber, chapterIndex, c);
      logAppearanceChange(newId, seriesId, volumeNumber, chapterIndex, c);
      continue;
    }

    const existing = getCharacter(id);
    // Any name form the delta used that isn't the canonical name becomes an alias.
    const incomingAliases = [...(c.aliases ?? [])];
    if (canonical && c.name.toLowerCase() !== canonical.toLowerCase()) incomingAliases.push(c.name);
    const mergedAliases = incomingAliases.length ? union(existing?.aliases, incomingAliases) : null;

    updateCharacter(id, {
      // Scalars: only write when the delta actually provides a value.
      ...(c.powerChange ? { currentPower: c.powerChange } : {}),
      ...(c.faction ? { faction: c.faction } : {}),
      ...(c.gender ? { gender: c.gender } : {}),
      ...(c.role ? { role: c.role } : {}),
      // A fundamental form change supersedes any incidental appearance text.
      ...(c.appearanceChange || c.appearance
        ? { appearance: c.appearanceChange || c.appearance }
        : {}),
      ...(c.personality ? { personality: c.personality } : {}),
      ...(c.backstory ? { backstory: c.backstory } : {}),
      ...(c.status ? { status: c.status } : {}),
      // Arrays: union with what's already stored.
      ...(mergedAliases ? { aliases: mergedAliases } : {}),
      ...(c.newSkills?.length ? { skills: union(existing?.skills, c.newSkills) } : {}),
      ...(c.newRelationships?.length
        ? { relationships: unionRelationships(existing?.relationships, c.newRelationships) }
        : {}),
      lastSeenVolume: volumeNumber,
      lastSeenChapter: chapterIndex,
    });

    // Keep the snapshot current so later chunks in this run match too.
    const snap = snapshot.characters.find((sc) => sc.name === canonical);
    if (snap) {
      if (c.powerChange) snap.currentPower = c.powerChange;
      if (mergedAliases) snap.aliases = mergedAliases;
    }

    if (c.event) logEvent(id, seriesId, volumeNumber, chapterIndex, c);
    logAppearanceChange(id, seriesId, volumeNumber, chapterIndex, c);
  }

  // Locations — insert-or-enrich by exact name (case-insensitive vs snapshot).
  mergeLocations(seriesId, delta.newLocations ?? [], snapshot, volumeNumber);

  // Lore
  if (delta.newLore) {
    insertWorldLore({
      seriesId,
      category: "other",
      content: delta.newLore,
      discoveredAtVolume: volumeNumber,
    });
    snapshot.lore.push(delta.newLore);
  }
}

/**
 * Insert-or-enrich locations against the running snapshot. Matching is by
 * exact name only (locations don't get aliases the way characters do); a
 * re-seen place has its provided fields updated so later volumes add detail.
 */
function mergeLocations(
  seriesId: string,
  locations: DeltaLocation[],
  snapshot: KBSnapshot,
  volumeNumber: number,
): void {
  for (const loc of locations) {
    const known = snapshot.locations.find((n) => n.toLowerCase() === loc.name.toLowerCase());
    const id = known ? findLocation(seriesId, known) : null;

    if (!id) {
      insertLocation({
        seriesId,
        name: loc.name,
        type: loc.type,
        description: loc.description,
        significance: loc.significance,
        visualPrompt: loc.visualPrompt,
        discoveredAtVolume: volumeNumber,
      });
      snapshot.locations.push(loc.name);
      continue;
    }

    updateLocation(id, {
      ...(loc.type ? { type: loc.type } : {}),
      ...(loc.description ? { description: loc.description } : {}),
      ...(loc.significance ? { significance: loc.significance } : {}),
      ...(loc.visualPrompt ? { visualPrompt: loc.visualPrompt } : {}),
    });
  }
}

/**
 * Find an existing character in the snapshot that the delta character refers to,
 * matching on the canonical name OR any alias (case-insensitive, both
 * directions). Returns the existing canonical name, or null if genuinely new.
 * This is what prevents duplicates when a later chunk / a resume names someone
 * by a nickname or a different form.
 */
function resolveExistingName(snapshot: KBSnapshot, c: DeltaCharacter): string | null {
  const keys = new Set(
    [c.name, ...(c.aliases ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  for (const sc of snapshot.characters) {
    const scKeys = [sc.name, ...sc.aliases].map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (scKeys.some((k) => keys.has(k))) return sc.name;
  }
  return null;
}

function logEvent(
  characterId: string,
  seriesId: string,
  volumeNumber: number,
  chapterIndex: number,
  c: DeltaCharacter,
): void {
  insertCharacterEvent({
    characterId,
    seriesId,
    volume: volumeNumber,
    chapter: chapterIndex,
    eventType: c.eventType ?? "other",
    description: c.event ?? "",
  });
}

/**
 * Snapshot a fundamental form change (life stage / transformation) as its own
 * timeline entry. The description is the complete new physical description, so
 * a stage portrait can be generated from the event alone (imageAI, Phase 6).
 */
function logAppearanceChange(
  characterId: string,
  seriesId: string,
  volumeNumber: number,
  chapterIndex: number,
  c: DeltaCharacter,
): void {
  if (!c.appearanceChange) return;
  insertCharacterEvent({
    characterId,
    seriesId,
    volume: volumeNumber,
    chapter: chapterIndex,
    eventType: "appearance_change",
    description: c.appearanceChange,
  });
}

// ---------------------------------------------------------------------------
// Per-chunk primitive (the loop lives in the background runner: kbRunner.ts)
// ---------------------------------------------------------------------------

/**
 * Analyze one chunk against the running snapshot and merge any delta into the
 * series tables. Mutates `snapshot` in place so subsequent chunks see the newly
 * merged facts and don't re-report them. Throws `GeminiRateLimitError` (from
 * `runPrompt`) when every model is cooling down — the caller pauses + resumes.
 *
 * If the model's JSON won't parse (typically a truncated response when a dense
 * chunk produces more delta than the output cap), the chunk is split in half
 * and each half retried — so one oversized chunk degrades gracefully instead of
 * failing the whole book. A fragment that still fails at the floor size is
 * skipped (best-effort) rather than aborting.
 */
export async function extractAndMergeChunk(
  seriesId: string,
  snapshot: KBSnapshot,
  chunk: BookChunk,
  volumeNumber: number,
  signal?: AbortSignal,
): Promise<void> {
  await processText(seriesId, snapshot, chunk.text, chunk.startChapter, volumeNumber, 0, signal);
}

async function processText(
  seriesId: string,
  snapshot: KBSnapshot,
  text: string,
  startChapter: number,
  volumeNumber: number,
  depth: number,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const delta = await extractDelta(snapshot, text, volumeNumber, signal);
    if (delta.hasChanges) mergeDelta(seriesId, delta, snapshot, volumeNumber, startChapter);
  } catch (e) {
    // Let the runner handle rate-limits (pause + resume) and user cancels; only
    // split on other failures (parse errors from truncated/garbled JSON).
    if (e instanceof GeminiRateLimitError || e instanceof GeminiAbortError || signal?.aborted) {
      throw e;
    }
    if (depth >= MAX_SPLIT_DEPTH || text.length <= MIN_SPLIT_CHARS) {
      console.warn(`KB: skipping a fragment after parse failure (${text.length} chars):`, e);
      return;
    }
    const cut = splitPoint(text);
    await processText(seriesId, snapshot, text.slice(0, cut), startChapter, volumeNumber, depth + 1, signal);
    await processText(seriesId, snapshot, text.slice(cut), startChapter, volumeNumber, depth + 1, signal);
  }
}

// ---------------------------------------------------------------------------
// Location backfill (series analyzed before locations existed)
// ---------------------------------------------------------------------------

/**
 * Derive notable locations from the *already-extracted* KB (world lore +
 * character factions) in a single Gemini call — a cheap backfill for series
 * analyzed before `newLocations` was part of the delta, avoiding a full
 * re-analysis. New extractions get locations from the per-chunk delta instead.
 * Returns how many locations were added.
 */
export async function deriveLocations(seriesId: string): Promise<number> {
  const snapshot = loadSnapshot(seriesId);
  const factions = [...new Set(snapshot.characters.map((c) => c.faction).filter(Boolean))];
  if (snapshot.lore.length === 0 && factions.length === 0) return 0;

  const prompt = `
Below is the accumulated knowledge base of a story (world lore + factions), in Vietnamese.
From it, list the most important LOCATIONS of the story (5-10 places): cities, sects,
academies, kingdoms, secret realms, battlegrounds. Skip minor one-off places.
${snapshot.locations.length ? `Already known (do NOT repeat): ${snapshot.locations.join(", ")}` : ""}

WORLD LORE:
${snapshot.lore.join("\n")}

FACTIONS: ${factions.join(", ")}

Return ONLY a valid JSON array (no markdown, no prose) in exactly this shape:
[
  {
    "name": "tên địa danh",
    "type": "thành phố | tông môn | học viện | quốc gia | bí cảnh | vùng đất | khác",
    "description": "mô tả địa danh",
    "significance": "vai trò của nơi này trong câu chuyện",
    "visualPrompt": "IN ENGLISH: a vivid one-sentence visual scene description of this place for an image generator — landscape, architecture, atmosphere, lighting"
  }
]

Rules:
- "visualPrompt" MUST be in English; everything else in Vietnamese, proper nouns (Hán Việt) intact.
- Only include places the lore actually supports — never invent.
- If the lore reveals no notable locations, return [].
`.trim();

  const raw = await runPrompt(prompt, { json: true, maxOutputTokens: 4096 });
  const before = snapshot.locations.length;
  mergeLocations(seriesId, cleanLocations(extractJson<unknown>(raw)), snapshot, 0);
  return snapshot.locations.length - before;
}

/** Split near the middle, preferring a newline so we don't cut mid-sentence. */
function splitPoint(text: string): number {
  const mid = Math.floor(text.length / 2);
  const nl = text.indexOf("\n", mid);
  return nl > mid ? nl : mid;
}

// ---------------------------------------------------------------------------
// Validators for loosely-typed model JSON
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

function relArray(v: unknown): Relationship[] {
  if (!Array.isArray(v)) return [];
  const out: Relationship[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name);
    if (!name) continue;
    out.push({ name, relation: str(r.relation) });
  }
  return out;
}

function cleanPowerStages(v: unknown): DeltaPowerStage[] {
  if (!Array.isArray(v)) return [];
  const out: DeltaPowerStage[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name);
    if (!name) continue;
    out.push({
      name,
      rank: typeof r.rank === "number" ? r.rank : out.length,
      description: str(r.description),
    });
  }
  return out;
}

function cleanCharacters(v: unknown): DeltaCharacter[] {
  if (!Array.isArray(v)) return [];
  const out: DeltaCharacter[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name);
    if (!name) continue;
    const eventType = str(r.eventType) as CharacterEventType;
    out.push({
      name,
      gender: str(r.gender) || undefined,
      role: str(r.role) || undefined,
      powerChange: str(r.powerChange) || undefined,
      faction: str(r.faction) || undefined,
      aliases: strArray(r.aliases),
      appearance: str(r.appearance) || undefined,
      personality: str(r.personality) || undefined,
      backstory: str(r.backstory) || undefined,
      status: str(r.status) || undefined,
      newSkills: strArray(r.newSkills),
      newRelationships: relArray(r.newRelationships),
      event: str(r.event) || undefined,
      eventType: EVENT_TYPES.includes(eventType) ? eventType : undefined,
      appearanceChange: str(r.appearanceChange) || undefined,
    });
  }
  return out;
}

function cleanLocations(v: unknown): DeltaLocation[] {
  if (!Array.isArray(v)) return [];
  const out: DeltaLocation[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.name);
    if (!name) continue;
    out.push({
      name,
      type: str(r.type) || undefined,
      description: str(r.description) || undefined,
      significance: str(r.significance) || undefined,
      visualPrompt: str(r.visualPrompt) || undefined,
    });
  }
  return out;
}

function union(existing: string[] | undefined, next: string[]): string[] {
  const seen = new Set((existing ?? []).map((s) => s.toLowerCase()));
  const out = [...(existing ?? [])];
  for (const s of next) {
    if (!seen.has(s.toLowerCase())) {
      seen.add(s.toLowerCase());
      out.push(s);
    }
  }
  return out;
}

function unionRelationships(existing: Relationship[] | undefined, next: Relationship[]): Relationship[] {
  const seen = new Set((existing ?? []).map((r) => r.name.toLowerCase()));
  const out = [...(existing ?? [])];
  for (const r of next) {
    if (!seen.has(r.name.toLowerCase())) {
      seen.add(r.name.toLowerCase());
      out.push(r);
    }
  }
  return out;
}
