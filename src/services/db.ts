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
      scrollY REAL,
      highlight TEXT,
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
  totalChapters?: number;
}): string {
  const id = genId("book");
  db.runSync(
    `INSERT INTO books (id, title, author, filePath, format, coverUrl, genre, tags, totalChapters, addedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      book.title,
      book.author ?? "",
      book.filePath,
      book.format ?? "",
      book.coverUrl ?? "",
      book.genre ?? "",
      JSON.stringify(book.tags ?? []),
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
    `INSERT INTO bookmarks (id, bookId, chapterIndex, scrollY, highlight, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      bookmark.bookId,
      bookmark.chapterIndex,
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

export interface SearchHit {
  bookId: string;
  chapterIndex: number;
  snippet: string;
}

export function searchContent(query: string): SearchHit[] {
  const normalized = normalizeVietnamese(query);
  if (!normalized) return [];
  return db.getAllSync<SearchHit>(
    `SELECT bookId, chapterIndex,
            snippet(book_content_fts, 3, '[', ']', '...', 20) AS snippet
     FROM book_content_fts
     WHERE content_normalized MATCH ?
     LIMIT 100`,
    [normalized],
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
  imageUrl?: string;
  lastSeenVolume?: number;
  lastSeenChapter?: number;
}): string {
  const id = genId("char");
  db.runSync(
    `INSERT INTO characters
       (id, seriesId, name, aliases, appearance, currentPower, faction, skills, relationships, backstory, imageUrl, lastSeenVolume, lastSeenChapter)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      char.imageUrl ?? "",
      char.lastSeenVolume ?? 0,
      char.lastSeenChapter ?? 0,
    ],
  );
  return id;
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

export function getCharacters(seriesId: string): Character[] {
  return db
    .getAllSync<CharacterRow>(
      "SELECT * FROM characters WHERE seriesId = ? ORDER BY name ASC",
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
  lastPosition?: ReadingPosition;
  totalChapters?: number;
  addedAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  chapterIndex: number;
  scrollY: number;
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
type BookRow = Omit<Book, "tags" | "lastPosition"> & {
  tags: string | null;
  lastPosition: string | null;
};
type PowerStageRow = Omit<PowerStage, "subStages"> & { subStages: string | null };
type CharacterRow = Omit<Character, "aliases" | "skills" | "relationships"> & {
  aliases: string | null;
  skills: string | null;
  relationships: string | null;
};
