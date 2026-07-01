/**
 * SQLite data layer (expo-sqlite v16, synchronous API).
 *
 * Conventions (see CLAUDE.md):
 * - Synchronous access: execSync / runSync / getAllSync / getFirstSync.
 * - Arrays/objects are JSON-encoded into TEXT columns.
 * - IDs: `<prefix>_<timestamp>_<rand>` (rand avoids collisions inside loops).
 *
 * Data model decision (see docs/PROGRESS.md):
 * Every book belongs to exactly one `series`. A standalone book is just a
 * 1-volume series. Characters / power stages / lore / events are SERIES-scoped
 * so a multi-volume knowledge base accumulates naturally; AI cache (tags,
 * summary, ...) is BOOK-scoped.
 */
import * as SQLite from "expo-sqlite";

import { normalizeVietnamese } from "../utils/text";

const db = SQLite.openDatabaseSync("bookapp.db");

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function initDB(): void {
  db.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      totalVolumesImported INTEGER DEFAULT 0,
      lastUpdated INTEGER
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      filePath TEXT NOT NULL,
      format TEXT,            -- 'epub' | 'pdf' | 'docx'
      coverUrl TEXT,
      genre TEXT,
      tags TEXT,              -- JSON array string
      chapterTitles TEXT,     -- JSON array of chapter titles (TOC)
      lastPosition TEXT,      -- JSON: { chapterIndex, scrollY }
      totalChapters INTEGER,
      addedAt INTEGER
    );

    -- Map each book/volume to a series.
    CREATE TABLE IF NOT EXISTS book_series (
      bookId TEXT NOT NULL,
      seriesId TEXT NOT NULL,
      volumeNumber INTEGER,
      PRIMARY KEY (bookId, seriesId)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      bookId TEXT NOT NULL,
      chapterIndex INTEGER,
      paragraphIndex INTEGER,
      scrollY REAL,
      highlight TEXT,         -- excerpt of the bookmarked paragraph
      note TEXT,
      createdAt INTEGER
    );

    -- AI analysis cache — analyze once, reuse forever (book-scoped).
    CREATE TABLE IF NOT EXISTS ai_cache (
      bookId TEXT NOT NULL,
      cacheKey TEXT NOT NULL,   -- 'summary' | 'power_system' | 'tags' | ...
      content TEXT NOT NULL,
      createdAt INTEGER,
      PRIMARY KEY (bookId, cacheKey)
    );

    -- Knowledge-base analysis checkpoint (one in-flight/paused job per series).
    -- Lets a whole-book pass resume after a rate-limit pause or app close.
    CREATE TABLE IF NOT EXISTS kb_analysis (
      seriesId TEXT PRIMARY KEY,
      bookId TEXT,
      volumeNumber INTEGER,
      nextChunk INTEGER,        -- index of the next chunk to process
      totalChunks INTEGER,
      status TEXT,              -- 'running' | 'paused' | 'error' | 'done'
      updatedAt INTEGER
    );

    -- Power system stages — accumulate across volumes (series-scoped).
    CREATE TABLE IF NOT EXISTS power_stages (
      id TEXT PRIMARY KEY,
      seriesId TEXT NOT NULL,
      stageName TEXT NOT NULL,
      rank INTEGER,
      description TEXT,
      subStages TEXT,           -- JSON array
      discoveredAtVolume INTEGER,
      discoveredAtChapter INTEGER
    );

    -- Characters — current state (series-scoped). Superset of single-book +
    -- multi-volume KB fields.
    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      seriesId TEXT NOT NULL,
      name TEXT NOT NULL,
      aliases TEXT,             -- JSON array
      appearance TEXT,
      currentPower TEXT,
      faction TEXT,
      skills TEXT,              -- JSON array
      relationships TEXT,       -- JSON array of { name, relation }
      backstory TEXT,
      gender TEXT,
      role TEXT,                -- 'protagonist' | 'antagonist' | 'supporting' | ...
      personality TEXT,
      status TEXT,              -- 'alive' | 'dead' | 'unknown' | ...
      imageUrl TEXT,
      lastSeenVolume INTEGER,
      lastSeenChapter INTEGER
    );

    -- Character events — append only.
    CREATE TABLE IF NOT EXISTS character_events (
      id TEXT PRIMARY KEY,
      characterId TEXT NOT NULL,
      seriesId TEXT NOT NULL,
      volume INTEGER,
      chapter INTEGER,
      eventType TEXT,           -- 'power_up' | 'relationship' | 'death' | 'reveal' | 'other'
      description TEXT
    );

    -- World lore — accumulate across volumes.
    CREATE TABLE IF NOT EXISTS world_lore (
      id TEXT PRIMARY KEY,
      seriesId TEXT NOT NULL,
      category TEXT,            -- 'geography' | 'faction' | 'history' | 'rule' | 'other'
      title TEXT,
      content TEXT,
      discoveredAtVolume INTEGER
    );

    -- Full-text search. Store original + diacritic-normalized content; we
    -- MATCH against the normalized column so Vietnamese search is accent-insensitive.
    CREATE VIRTUAL TABLE IF NOT EXISTS book_content_fts
      USING fts5(bookId UNINDEXED, chapterIndex UNINDEXED, content, content_normalized);
  `);
}

/**
 * Wipe all data by dropping every table and recreating the schema. Used by the
 * Settings "Clear all data" action for testing from a clean slate. Keeps the
 * same DB handle valid (no close/reopen, so no reload needed for the DB itself).
 */
export function resetDatabase(): void {
  db.execSync(`
    DROP TABLE IF EXISTS series;
    DROP TABLE IF EXISTS books;
    DROP TABLE IF EXISTS book_series;
    DROP TABLE IF EXISTS bookmarks;
    DROP TABLE IF EXISTS ai_cache;
    DROP TABLE IF EXISTS kb_analysis;
    DROP TABLE IF EXISTS power_stages;
    DROP TABLE IF EXISTS characters;
    DROP TABLE IF EXISTS character_events;
    DROP TABLE IF EXISTS world_lore;
    DROP TABLE IF EXISTS book_content_fts;
  `);
  initDB();
}

// ---------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------

export function saveBook(book: {
  title: string;
  author?: string;
  filePath: string;
  format?: BookFormat;
  coverUrl?: string;
  genre?: string;
  tags?: string[];
  chapterTitles?: string[];
  totalChapters?: number;
}): string {
  const id = genId("book");
  db.runSync(
    `INSERT INTO books (id, title, author, filePath, format, coverUrl, genre, tags, chapterTitles, totalChapters, addedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      book.title,
      book.author ?? "",
      book.filePath,
      book.format ?? "",
      book.coverUrl ?? "",
      book.genre ?? "",
      JSON.stringify(book.tags ?? []),
      JSON.stringify(book.chapterTitles ?? []),
      book.totalChapters ?? 0,
      Date.now(),
    ],
  );
  return id;
}

function hydrateBook(row: BookRow): Book {
  return {
    ...row,
    tags: safeParse<string[]>(row.tags, []),
    chapterTitles: safeParse<string[]>(row.chapterTitles, []),
    lastPosition: row.lastPosition
      ? safeParse<ReadingPosition>(row.lastPosition, { chapterIndex: 0, scrollY: 0 })
      : undefined,
  };
}

export function getAllBooks(): Book[] {
  return db
    .getAllSync<BookRow>("SELECT * FROM books ORDER BY addedAt DESC")
    .map(hydrateBook);
}

export function getBook(bookId: string): Book | null {
  const row = db.getFirstSync<BookRow>("SELECT * FROM books WHERE id = ?", [bookId]);
  return row ? hydrateBook(row) : null;
}

export function updateBookPosition(bookId: string, position: ReadingPosition): void {
  db.runSync("UPDATE books SET lastPosition = ? WHERE id = ?", [
    JSON.stringify(position),
    bookId,
  ]);
}

export function updateBookCover(bookId: string, coverUrl: string): void {
  db.runSync("UPDATE books SET coverUrl = ? WHERE id = ?", [coverUrl, bookId]);
}

export function updateBookTags(bookId: string, tags: string[]): void {
  db.runSync("UPDATE books SET tags = ? WHERE id = ?", [JSON.stringify(tags), bookId]);
}

export function deleteBook(bookId: string): void {
  db.runSync("DELETE FROM books WHERE id = ?", [bookId]);
  db.runSync("DELETE FROM bookmarks WHERE bookId = ?", [bookId]);
  db.runSync("DELETE FROM ai_cache WHERE bookId = ?", [bookId]);
  db.runSync("DELETE FROM book_series WHERE bookId = ?", [bookId]);
  clearBookIndex(bookId);
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export function addBookmark(bookmark: Omit<Bookmark, "id" | "createdAt">): string {
  const id = genId("bm");
  db.runSync(
    `INSERT INTO bookmarks (id, bookId, chapterIndex, paragraphIndex, scrollY, highlight, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      bookmark.bookId,
      bookmark.chapterIndex,
      bookmark.paragraphIndex ?? 0,
      bookmark.scrollY,
      bookmark.highlight ?? "",
      bookmark.note ?? "",
      Date.now(),
    ],
  );
  return id;
}

export function getBookmarks(bookId: string): Bookmark[] {
  return db.getAllSync<Bookmark>(
    "SELECT * FROM bookmarks WHERE bookId = ? ORDER BY createdAt DESC",
    [bookId],
  );
}

export function deleteBookmark(id: string): void {
  db.runSync("DELETE FROM bookmarks WHERE id = ?", [id]);
}

// ---------------------------------------------------------------------------
// AI cache — always check before calling Gemini.
// ---------------------------------------------------------------------------

export function getAICache(bookId: string, key: string): string | null {
  const row = db.getFirstSync<{ content: string }>(
    "SELECT content FROM ai_cache WHERE bookId = ? AND cacheKey = ?",
    [bookId, key],
  );
  return row?.content ?? null;
}

export function setAICache(bookId: string, key: string, content: string): void {
  db.runSync(
    `INSERT OR REPLACE INTO ai_cache (bookId, cacheKey, content, createdAt)
     VALUES (?, ?, ?, ?)`,
    [bookId, key, content, Date.now()],
  );
}

export function clearAICache(bookId: string): void {
  db.runSync("DELETE FROM ai_cache WHERE bookId = ?", [bookId]);
}

// ---------------------------------------------------------------------------
// Full-text search (FTS5, diacritic-normalized)
// ---------------------------------------------------------------------------

export function indexChapter(bookId: string, chapterIndex: number, content: string): void {
  db.runSync(
    `INSERT INTO book_content_fts (bookId, chapterIndex, content, content_normalized)
     VALUES (?, ?, ?, ?)`,
    [bookId, chapterIndex, content, normalizeVietnamese(content)],
  );
}

export function clearBookIndex(bookId: string): void {
  db.runSync("DELETE FROM book_content_fts WHERE bookId = ?", [bookId]);
}

/**
 * Read a book's chapters back, in order. The FTS table doubles as our chapter
 * store: `indexChapter` saved the original (un-normalized) text per chapter, so
 * the reader can rehydrate without re-parsing the source file.
 */
export function getChapters(bookId: string): string[] {
  return db
    .getAllSync<{ content: string }>(
      "SELECT content FROM book_content_fts WHERE bookId = ? ORDER BY chapterIndex ASC",
      [bookId],
    )
    .map((r) => r.content);
}

export interface SearchHit {
  bookId: string;
  chapterIndex: number;
  snippet: string;
}

export function searchContent(query: string, bookId?: string): SearchHit[] {
  // Normalize (diacritic-insensitive), then tokenize into bare alphanumeric
  // terms. Raw user input can contain FTS5 operators (", *, :, -, AND, …) that
  // throw a syntax error; we rebuild a safe AND-of-prefix query instead.
  const tokens = normalizeVietnamese(query).match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return [];
  const ftsQuery = tokens.map((t) => `${t}*`).join(" ");

  const where = bookId
    ? "content_normalized MATCH ? AND bookId = ?"
    : "content_normalized MATCH ?";
  const params = bookId ? [ftsQuery, bookId] : [ftsQuery];

  return db.getAllSync<SearchHit>(
    `SELECT bookId, chapterIndex,
            snippet(book_content_fts, 3, '[', ']', '...', 20) AS snippet
     FROM book_content_fts
     WHERE ${where}
     LIMIT 100`,
    params,
  );
}

// ---------------------------------------------------------------------------
// Series + book_series
// ---------------------------------------------------------------------------

export function insertSeries(name: string): string {
  const id = genId("series");
  db.runSync(
    "INSERT INTO series (id, name, totalVolumesImported, lastUpdated) VALUES (?, ?, 0, ?)",
    [id, name, Date.now()],
  );
  return id;
}

export function getAllSeries(): Series[] {
  return db.getAllSync<Series>("SELECT * FROM series ORDER BY lastUpdated DESC");
}

export function getSeries(seriesId: string): Series | null {
  return (
    db.getFirstSync<Series>("SELECT * FROM series WHERE id = ?", [seriesId]) ?? null
  );
}

export function updateSeriesVolumeCount(seriesId: string, volumeNumber: number): void {
  db.runSync(
    `UPDATE series
     SET totalVolumesImported = MAX(totalVolumesImported, ?), lastUpdated = ?
     WHERE id = ?`,
    [volumeNumber, Date.now(), seriesId],
  );
}

export function insertBookSeries(
  bookId: string,
  seriesId: string,
  volumeNumber: number,
): void {
  db.runSync(
    "INSERT OR REPLACE INTO book_series (bookId, seriesId, volumeNumber) VALUES (?, ?, ?)",
    [bookId, seriesId, volumeNumber],
  );
}

export function getSeriesIdForBook(bookId: string): string | null {
  const row = db.getFirstSync<{ seriesId: string }>(
    "SELECT seriesId FROM book_series WHERE bookId = ? LIMIT 1",
    [bookId],
  );
  return row?.seriesId ?? null;
}

/** Volume number of a book within its series (1 for standalone / unknown). */
export function getBookVolume(bookId: string): number {
  const row = db.getFirstSync<{ volumeNumber: number }>(
    "SELECT volumeNumber FROM book_series WHERE bookId = ? LIMIT 1",
    [bookId],
  );
  return row?.volumeNumber ?? 1;
}

/**
 * Wipe a series' accumulated knowledge base (power stages, characters + their
 * events, lore). Used when the user re-analyzes to rebuild from scratch.
 */
export function clearSeriesKB(seriesId: string): void {
  db.runSync("DELETE FROM power_stages WHERE seriesId = ?", [seriesId]);
  db.runSync("DELETE FROM character_events WHERE seriesId = ?", [seriesId]);
  db.runSync("DELETE FROM characters WHERE seriesId = ?", [seriesId]);
  db.runSync("DELETE FROM world_lore WHERE seriesId = ?", [seriesId]);
}

// ---------------------------------------------------------------------------
// KB analysis checkpoint (resume a whole-book pass across pauses / app close)
// ---------------------------------------------------------------------------

export type KBAnalysisStatus = "running" | "paused" | "error" | "done";

export interface KBAnalysisState {
  seriesId: string;
  bookId: string;
  volumeNumber: number;
  nextChunk: number;
  totalChunks: number;
  status: KBAnalysisStatus;
  updatedAt: number;
}

export function getAnalysisState(seriesId: string): KBAnalysisState | null {
  return (
    db.getFirstSync<KBAnalysisState>("SELECT * FROM kb_analysis WHERE seriesId = ?", [seriesId]) ??
    null
  );
}

export function setAnalysisState(state: Omit<KBAnalysisState, "updatedAt">): void {
  db.runSync(
    `INSERT OR REPLACE INTO kb_analysis
       (seriesId, bookId, volumeNumber, nextChunk, totalChunks, status, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      state.seriesId,
      state.bookId,
      state.volumeNumber,
      state.nextChunk,
      state.totalChunks,
      state.status,
      Date.now(),
    ],
  );
}

export function clearAnalysisState(seriesId: string): void {
  db.runSync("DELETE FROM kb_analysis WHERE seriesId = ?", [seriesId]);
}

/** Any analysis left mid-flight (running/paused) — used to offer resume on launch. */
export function getInterruptedAnalysis(): KBAnalysisState | null {
  return (
    db.getFirstSync<KBAnalysisState>(
      "SELECT * FROM kb_analysis WHERE status IN ('running', 'paused') ORDER BY updatedAt DESC LIMIT 1",
    ) ?? null
  );
}

export function getBooksInSeries(seriesId: string): Book[] {
  return db
    .getAllSync<BookRow>(
      `SELECT b.* FROM books b
       JOIN book_series bs ON bs.bookId = b.id
       WHERE bs.seriesId = ?
       ORDER BY bs.volumeNumber ASC`,
      [seriesId],
    )
    .map(hydrateBook);
}

// ---------------------------------------------------------------------------
// Power stages
// ---------------------------------------------------------------------------

export function insertPowerStage(stage: Omit<PowerStage, "id">): string {
  const id = genId("ps");
  db.runSync(
    `INSERT INTO power_stages (id, seriesId, stageName, rank, description, subStages, discoveredAtVolume, discoveredAtChapter)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      stage.seriesId,
      stage.stageName,
      stage.rank ?? 0,
      stage.description ?? "",
      JSON.stringify(stage.subStages ?? []),
      stage.discoveredAtVolume ?? 0,
      stage.discoveredAtChapter ?? 0,
    ],
  );
  return id;
}

export function getPowerStages(seriesId: string): PowerStage[] {
  return db
    .getAllSync<PowerStageRow>(
      "SELECT * FROM power_stages WHERE seriesId = ? ORDER BY rank ASC",
      [seriesId],
    )
    .map((row) => ({ ...row, subStages: safeParse<string[]>(row.subStages, []) }));
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

export function insertCharacter(char: {
  seriesId: string;
  name: string;
  aliases?: string[];
  appearance?: string;
  currentPower?: string;
  faction?: string;
  skills?: string[];
  relationships?: Relationship[];
  backstory?: string;
  gender?: string;
  role?: string;
  personality?: string;
  status?: string;
  imageUrl?: string;
  lastSeenVolume?: number;
  lastSeenChapter?: number;
}): string {
  const id = genId("char");
  db.runSync(
    `INSERT INTO characters
       (id, seriesId, name, aliases, appearance, currentPower, faction, skills, relationships, backstory, gender, role, personality, status, imageUrl, lastSeenVolume, lastSeenChapter)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      char.seriesId,
      char.name,
      JSON.stringify(char.aliases ?? []),
      char.appearance ?? "",
      char.currentPower ?? "",
      char.faction ?? "",
      JSON.stringify(char.skills ?? []),
      JSON.stringify(char.relationships ?? []),
      char.backstory ?? "",
      char.gender ?? "",
      char.role ?? "",
      char.personality ?? "",
      char.status ?? "",
      char.imageUrl ?? "",
      char.lastSeenVolume ?? 0,
      char.lastSeenChapter ?? 0,
    ],
  );
  return id;
}

/**
 * Partial-update a character's enrichable fields. Only provided keys are
 * written (undefined keys are left untouched), so the KB merge can accrete
 * detail across chunks/volumes without wiping earlier data. Array fields are
 * JSON-encoded.
 */
export function updateCharacter(
  id: string,
  fields: Partial<{
    aliases: string[];
    appearance: string;
    currentPower: string;
    faction: string;
    skills: string[];
    relationships: Relationship[];
    backstory: string;
    gender: string;
    role: string;
    personality: string;
    status: string;
    imageUrl: string;
    lastSeenVolume: number;
    lastSeenChapter: number;
  }>,
): void {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  const set = (col: string, val: string | number) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };

  if (fields.aliases !== undefined) set("aliases", JSON.stringify(fields.aliases));
  if (fields.skills !== undefined) set("skills", JSON.stringify(fields.skills));
  if (fields.relationships !== undefined) set("relationships", JSON.stringify(fields.relationships));
  const scalarKeys = [
    "appearance",
    "currentPower",
    "faction",
    "backstory",
    "gender",
    "role",
    "personality",
    "status",
    "imageUrl",
    "lastSeenVolume",
    "lastSeenChapter",
  ] as const;
  for (const key of scalarKeys) {
    const val = fields[key];
    if (val !== undefined) set(key, val);
  }

  if (sets.length === 0) return;
  params.push(id);
  db.runSync(`UPDATE characters SET ${sets.join(", ")} WHERE id = ?`, params);
}

/** Find a character in a series by name (or alias). Returns its id or null. */
export function findCharacter(seriesId: string, name: string): string | null {
  const row = db.getFirstSync<{ id: string }>(
    "SELECT id FROM characters WHERE seriesId = ? AND name = ? LIMIT 1",
    [seriesId, name],
  );
  return row?.id ?? null;
}

function hydrateCharacter(row: CharacterRow): Character {
  return {
    ...row,
    aliases: safeParse<string[]>(row.aliases, []),
    skills: safeParse<string[]>(row.skills, []),
    relationships: safeParse<Relationship[]>(row.relationships, []),
  };
}

/**
 * Characters ordered by plot importance: main cast first, side characters last.
 * Primary key is `role` (protagonist → antagonist → supporting → unknown, with
 * common Vietnamese synonyms), then how often they appear (event count desc),
 * then name. Role strings come from the AI and may vary, so match loosely.
 */
export function getCharacters(seriesId: string): Character[] {
  return db
    .getAllSync<CharacterRow>(
      `SELECT * FROM characters WHERE seriesId = ?
       ORDER BY
         CASE
           WHEN lower(role) LIKE '%protagonist%' OR lower(role) LIKE '%main%'
             OR lower(role) LIKE '%chính%' THEN 0
           WHEN lower(role) LIKE '%antagonist%' OR lower(role) LIKE '%villain%'
             OR lower(role) LIKE '%phản%' THEN 1
           WHEN lower(role) LIKE '%support%' OR lower(role) LIKE '%phụ%' THEN 2
           ELSE 3
         END ASC,
         (SELECT COUNT(*) FROM character_events e WHERE e.characterId = characters.id) DESC,
         name ASC`,
      [seriesId],
    )
    .map(hydrateCharacter);
}

export function getCharacter(id: string): Character | null {
  const row = db.getFirstSync<CharacterRow>("SELECT * FROM characters WHERE id = ?", [id]);
  return row ? hydrateCharacter(row) : null;
}

export function updateCharacterPower(
  characterId: string,
  currentPower: string,
  volume: number,
  chapter: number,
): void {
  db.runSync(
    "UPDATE characters SET currentPower = ?, lastSeenVolume = ?, lastSeenChapter = ? WHERE id = ?",
    [currentPower, volume, chapter, characterId],
  );
}

export function updateCharacterImage(characterId: string, imageUrl: string): void {
  db.runSync("UPDATE characters SET imageUrl = ? WHERE id = ?", [imageUrl, characterId]);
}

// ---------------------------------------------------------------------------
// Character events
// ---------------------------------------------------------------------------

export function insertCharacterEvent(event: Omit<CharacterEvent, "id">): string {
  const id = genId("ev");
  db.runSync(
    `INSERT INTO character_events (id, characterId, seriesId, volume, chapter, eventType, description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      event.characterId,
      event.seriesId,
      event.volume ?? 0,
      event.chapter ?? 0,
      event.eventType ?? "other",
      event.description ?? "",
    ],
  );
  return id;
}

export function getCharacterEvents(characterId: string): CharacterEvent[] {
  return db.getAllSync<CharacterEvent>(
    "SELECT * FROM character_events WHERE characterId = ? ORDER BY volume ASC, chapter ASC",
    [characterId],
  );
}

// ---------------------------------------------------------------------------
// World lore
// ---------------------------------------------------------------------------

export function insertWorldLore(lore: Omit<WorldLore, "id">): string {
  const id = genId("lore");
  db.runSync(
    `INSERT INTO world_lore (id, seriesId, category, title, content, discoveredAtVolume)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      lore.seriesId,
      lore.category ?? "other",
      lore.title ?? "",
      lore.content ?? "",
      lore.discoveredAtVolume ?? 0,
    ],
  );
  return id;
}

export function getWorldLore(seriesId: string): WorldLore[] {
  return db.getAllSync<WorldLore>("SELECT * FROM world_lore WHERE seriesId = ?", [seriesId]);
}

// ---------------------------------------------------------------------------
// Helpers + types
// ---------------------------------------------------------------------------

function safeParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export type BookFormat = "epub" | "pdf" | "docx";

export interface ReadingPosition {
  chapterIndex: number;
  scrollY: number;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  filePath: string;
  format?: BookFormat | "";
  coverUrl?: string;
  genre?: string;
  tags: string[];
  /** Per-chapter TOC titles, parallel to chapter indices. */
  chapterTitles: string[];
  lastPosition?: ReadingPosition;
  totalChapters?: number;
  addedAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterIndex: number;
  /** Index of the bookmarked paragraph within the chapter. */
  paragraphIndex: number;
  scrollY: number;
  /** Excerpt of the bookmarked paragraph, shown in the bookmark list. */
  highlight?: string;
  note?: string;
  createdAt: number;
}

export interface Series {
  id: string;
  name: string;
  totalVolumesImported: number;
  lastUpdated: number;
}

export interface PowerStage {
  id: string;
  seriesId: string;
  stageName: string;
  rank: number;
  description: string;
  subStages: string[];
  discoveredAtVolume: number;
  discoveredAtChapter: number;
}

export interface Relationship {
  name: string;
  relation: string;
}

export interface Character {
  id: string;
  seriesId: string;
  name: string;
  aliases: string[];
  appearance?: string;
  currentPower?: string;
  faction?: string;
  skills: string[];
  relationships: Relationship[];
  backstory?: string;
  gender?: string;
  role?: string;
  personality?: string;
  status?: string;
  imageUrl?: string;
  lastSeenVolume?: number;
  lastSeenChapter?: number;
}

export type CharacterEventType =
  | "power_up"
  | "relationship"
  | "death"
  | "reveal"
  | "other";

export interface CharacterEvent {
  id: string;
  characterId: string;
  seriesId: string;
  volume: number;
  chapter: number;
  eventType: CharacterEventType;
  description: string;
}

export interface WorldLore {
  id: string;
  seriesId: string;
  category: string;
  title?: string;
  content: string;
  discoveredAtVolume: number;
}

// Raw row shapes (TEXT columns hold JSON; hydrated above).
type BookRow = Omit<Book, "tags" | "chapterTitles" | "lastPosition"> & {
  tags: string | null;
  chapterTitles: string | null;
  lastPosition: string | null;
};
type PowerStageRow = Omit<PowerStage, "subStages"> & { subStages: string | null };
type CharacterRow = Omit<Character, "aliases" | "skills" | "relationships"> & {
  aliases: string | null;
  skills: string | null;
  relationships: string | null;
};
