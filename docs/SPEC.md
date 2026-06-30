# BookApp — Personal Android Reading App
> React Native + Expo | 100% Free | Android Only | Personal Use

---

## Overview

A personal Android e-book reader with AI-powered features. All AI features are free. No backend, no server — everything stored locally on device.

---

## Full Feature List

### Core Reading
- Import books: **EPUB, PDF, DOCX**
- Auto-detect title vs body content (heading styles, metadata)
- Auto-generate chapter/TOC from headings
- Bookmark + reading position saved
- Full-text search (SQLite FTS5)
- Background themes (white, sepia, dark, black)
- Font size & font family adjustment

### Audio
- **TTS (Text-to-Speech)** — reads book aloud via Android built-in engine
- Choose voice (male/female), adjust speed (0.5x – 2x)
- Plays in background (foreground service + lock screen controls)
- **Background music** by mood tag — offline MP3, plays alongside TTS at low volume

### AI — Images (Pollinations.ai — free, no API key)
- **AI Book Cover** — auto-generated from book title + genre
- **Character Illustrations** — generated from character description extracted by Gemini
- Style auto-matched to genre: xianxia, wuxia, fantasy, romance, sci-fi, etc.

### AI — Text Analysis (Gemini Flash — 1500 req/day free)
- **Story summary** — world-building, setting, lore
- **Power system** — ranks, skills, factions (for action/cultivation stories)
- **Character profiles** — power level, relationships, backstory
- **Word/phrase explainer** — long-press any word → popup explanation in context
- **Auto tag** — Gemini reads content → assigns genre/mood tags
- **Music mapping** — tags → select matching offline MP3 playlist

---

## Tech Stack

### Foundation
| Package | Version | Purpose |
|---|---|---|
| `expo` | ~51.0.0 | Core framework, managed workflow |
| `expo-router` | ~3.5.0 | File-based routing (no React Navigation needed) |
| TypeScript | latest | Type safety, autocomplete, catch bugs early |

### UI
| Package | Purpose |
|---|---|
| RN core components | `View`, `Text`, `FlatList`, `Pressable` — no heavy UI lib |
| `react-native-reanimated` ~3.10.0 | Smooth animations only where needed |

### State Management
| Package | Purpose |
|---|---|
| `zustand` ^4.5.2 | 2KB, no boilerplate — replaces Redux entirely |
| `react-native-mmkv` ^2.12.2 | 10x faster than AsyncStorage for settings/preferences |

### Book Parsing
| Package | Purpose |
|---|---|
| `react-native-webview` 13.8.6 | Renders epub.js for EPUB files |
| `expo-file-system` ~17.0.0 | Read PDF/DOCX as raw text, store files |
| `expo-document-picker` ~12.0.0 | Import files from device storage |

### Audio
| Package | Purpose |
|---|---|
| `expo-speech` ~12.0.0 | TTS, free, built-in Android engine, Vietnamese support |
| `expo-av` ~14.0.0 | Background music, offline MP3 playback, loop |

### AI & Storage
| Package | Purpose |
|---|---|
| `@google/generative-ai` ^0.15.0 | Gemini Flash API — text analysis |
| Pollinations.ai | Image generation — no package needed, just fetch URL |
| `expo-sqlite` ~14.0.0 | Local DB: books, bookmarks, AI cache, FTS5 search |

### Intentionally NOT used
- ❌ Redux / RTK → Zustand is enough, 10x lighter
- ❌ Axios → native `fetch` is sufficient
- ❌ NativeWind / styled-components → `StyleSheet.create()`, no CSS parsing overhead
- ❌ React Navigation → Expo Router already included
- ❌ react-native-pdf → requires Dev Client, complex build. `expo-file-system` for text extraction is enough
- ❌ react-native-track-player → heavy native build. `expo-av` + `expo-speech` covers the use case

---

## Project Setup

```bash
npx create-expo-app@latest BookApp --template tabs
cd BookApp
npx expo install expo-speech expo-av expo-sqlite expo-file-system \
  expo-document-picker react-native-webview react-native-reanimated \
  react-native-mmkv zustand @google/generative-ai
```

---

## Project Structure

```
BookApp/
├── app/                          # Expo Router
│   ├── (tabs)/
│   │   ├── library.tsx           # Book library screen
│   │   ├── reader.tsx            # Reading screen
│   │   └── settings.tsx          # Settings
│   ├── character/[id].tsx        # Character profile screen
│   └── _layout.tsx
├── src/
│   ├── components/
│   │   ├── Reader/               # Reader UI components
│   │   ├── AudioPlayer/          # TTS + music controls
│   │   └── AIPanel/              # AI summary, character cards
│   ├── services/
│   │   ├── epub.ts               # EPUB parser (epub.js via WebView)
│   │   ├── pdf.ts                # PDF text extractor
│   │   ├── docx.ts               # DOCX text extractor
│   │   ├── tts.ts                # expo-speech wrapper
│   │   ├── music.ts              # expo-av background music
│   │   ├── gemini.ts             # Gemini API client
│   │   ├── imageAI.ts            # Pollinations.ai image generator
│   │   └── db.ts                 # expo-sqlite (books, bookmarks, cache)
│   ├── store/
│   │   ├── bookStore.ts          # Zustand: current book state
│   │   ├── audioStore.ts         # Zustand: TTS + music state
│   │   └── settingsStore.ts      # Zustand: theme, font, preferences
│   └── constants/
│       ├── musicMap.ts           # Tag → MP3 filename mapping
│       └── styleMap.ts           # Genre → Pollinations style prompt
├── assets/
│   └── music/                    # Bundled royalty-free MP3s (~20-30 files)
└── package.json
```

---

## Code Samples

### 1. Gemini Client — `src/services/gemini.ts`

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.EXPO_PUBLIC_GEMINI_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Extract character info from a chunk of text
export async function extractCharacters(textChunk: string) {
  const prompt = `
    Analyze this story excerpt and extract character information.
    Return ONLY valid JSON, no markdown, no explanation.
    
    Format:
    {
      "characters": [
        {
          "name": "string",
          "appearance": "string",
          "powerLevel": "string",
          "skills": ["string"],
          "relationships": [{ "name": "string", "relation": "string" }],
          "backstory": "string"
        }
      ]
    }
    
    Text: ${textChunk}
  `;
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return JSON.parse(text);
}

// Auto-generate tags from book content
export async function generateTags(textSample: string): Promise<string[]> {
  const prompt = `
    Read this story excerpt and return ONLY a JSON array of mood/genre tags.
    Choose from: action, romance, mystery, fantasy, scifi, comedy, sad, 
    horror, adventure, cultivation, wuxia, xianxia, thriller, slice-of-life
    Max 4 tags. Example: ["action", "fantasy", "cultivation"]
    
    Text: ${textSample}
  `;
  const result = await model.generateContent(prompt);
  return JSON.parse(result.response.text());
}

// Explain a word in context
export async function explainWord(word: string, context: string): Promise<string> {
  const prompt = `
    In the context of this story passage, briefly explain what "${word}" means.
    Keep it under 3 sentences, simple language.
    Context: "${context}"
  `;
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// Summarize power system
export async function extractPowerSystem(textChunk: string): Promise<string> {
  const prompt = `
    From this story text, extract and summarize the power system if one exists.
    Include: rank names, how power is measured, notable abilities/skills mentioned.
    If no power system, return "none".
    Return as plain text, keep it concise.
    
    Text: ${textChunk}
  `;
  const result = await model.generateContent(prompt);
  return result.response.text();
}
```

---

### 2. AI Image Generator — `src/services/imageAI.ts`

```typescript
// No API key needed — Pollinations.ai is completely free

const STYLE_MAP: Record<string, string> = {
  xianxia:       "chinese fantasy xianxia cultivation style, dramatic lighting, detailed armor",
  wuxia:         "wuxia martial arts style, ancient chinese setting, ink painting aesthetic",
  fantasy:       "western high fantasy art, epic illustration, detailed environment",
  romance:       "soft anime style, shoujo art, warm pastel colors",
  scifi:         "cyberpunk futuristic style, neon lighting, technological",
  mystery:       "noir style, dark moody atmosphere, cinematic",
  horror:        "dark gothic horror, eerie atmosphere, dramatic shadows",
  "slice-of-life": "cozy anime style, warm lighting, everyday setting",
};

export function generateBookCover(title: string, genre: string): string {
  const style = STYLE_MAP[genre] ?? "digital art, detailed illustration";
  const prompt = `book cover for "${title}", ${style}, professional book cover design, high quality`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=400&height=600&nologo=true`;
}

export function generateCharacterImage(
  characterName: string,
  appearance: string,
  genre: string
): string {
  const style = STYLE_MAP[genre] ?? "digital art, character portrait";
  const prompt = `${characterName}, ${appearance}, ${style}, character portrait, full body, high quality`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=400&height=600&nologo=true`;
}
```

---

### 3. Background Music — `src/services/music.ts`

```typescript
import { Audio } from "expo-av";

// Tag → MP3 file mapping (files bundled in assets/music/)
const MUSIC_MAP: Record<string, string[]> = {
  action:        ["battle_epic.mp3", "intense_fight.mp3"],
  romance:       ["soft_piano.mp3", "acoustic_gentle.mp3"],
  mystery:       ["dark_ambient.mp3", "suspense.mp3"],
  fantasy:       ["orchestral_magic.mp3", "ethereal.mp3"],
  xianxia:       ["chinese_erhu.mp3", "cultivation_ambient.mp3"],
  wuxia:         ["guqin_battle.mp3", "ancient_china.mp3"],
  scifi:         ["electronic_ambient.mp3", "synthwave_soft.mp3"],
  comedy:        ["light_ukulele.mp3", "cheerful_acoustic.mp3"],
  sad:           ["melancholy_piano.mp3", "emotional_strings.mp3"],
  horror:        ["creepy_ambient.mp3", "dark_tension.mp3"],
  "slice-of-life": ["lofi_chill.mp3", "cozy_cafe.mp3"],
};

// Source map for bundled assets
const MUSIC_SOURCES: Record<string, any> = {
  "battle_epic.mp3":      require("../../assets/music/battle_epic.mp3"),
  "soft_piano.mp3":       require("../../assets/music/soft_piano.mp3"),
  "dark_ambient.mp3":     require("../../assets/music/dark_ambient.mp3"),
  "orchestral_magic.mp3": require("../../assets/music/orchestral_magic.mp3"),
  // ... add all files
};

let soundInstance: Audio.Sound | null = null;

export async function playMusicForTags(tags: string[]): Promise<void> {
  // Find first matching tag
  const matchedTag = tags.find((tag) => MUSIC_MAP[tag]);
  if (!matchedTag) return;

  const playlist = MUSIC_MAP[matchedTag];
  const file = playlist[Math.floor(Math.random() * playlist.length)];
  const source = MUSIC_SOURCES[file];
  if (!source) return;

  await stopMusic();

  await Audio.setAudioModeAsync({ staysActiveInBackground: true });
  const { sound } = await Audio.Sound.createAsync(source, {
    isLooping: true,
    volume: 0.2, // Low volume — background only
  });
  soundInstance = sound;
  await sound.playAsync();
}

export async function stopMusic(): Promise<void> {
  if (soundInstance) {
    await soundInstance.stopAsync();
    await soundInstance.unloadAsync();
    soundInstance = null;
  }
}

export async function setMusicVolume(volume: number): Promise<void> {
  if (soundInstance) {
    await soundInstance.setVolumeAsync(Math.max(0, Math.min(1, volume)));
  }
}
```

---

### 4. TTS Service — `src/services/tts.ts`

```typescript
import * as Speech from "expo-speech";

export interface TTSOptions {
  rate?: number;   // 0.1 – 2.0, default 1.0
  pitch?: number;  // 0.5 – 2.0, default 1.0
  voice?: string;  // voice identifier from getAvailableVoices()
  language?: string; // default "vi-VN"
}

export async function getAvailableVoices() {
  return await Speech.getAvailableVoicesAsync();
}

export function speak(text: string, options: TTSOptions = {}): void {
  const { rate = 1.0, pitch = 1.0, voice, language = "vi-VN" } = options;

  // Split long text into chunks (Speech API has character limits)
  const chunks = splitIntoChunks(text, 3000);

  const speakChunk = (index: number) => {
    if (index >= chunks.length) return;
    Speech.speak(chunks[index], {
      rate,
      pitch,
      voice,
      language,
      onDone: () => speakChunk(index + 1),
      onError: (error) => console.error("TTS error:", error),
    });
  };

  speakChunk(0);
}

export function stopSpeaking(): void {
  Speech.stop();
}

export function isSpeaking(): boolean {
  return Speech.isSpeakingAsync() as unknown as boolean;
}

function splitIntoChunks(text: string, maxLength: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length > maxLength) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
```

---

### 5. SQLite Database — `src/services/db.ts`

```typescript
import * as SQLite from "expo-sqlite";

const db = SQLite.openDatabaseSync("bookapp.db");

export function initDB(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      filePath TEXT NOT NULL,
      coverUrl TEXT,
      genre TEXT,
      tags TEXT,           -- JSON array string
      lastPosition TEXT,   -- JSON: { chapterIndex, scrollY }
      totalChapters INTEGER,
      addedAt INTEGER
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      bookId TEXT NOT NULL,
      chapterIndex INTEGER,
      scrollY REAL,
      highlight TEXT,
      note TEXT,
      createdAt INTEGER,
      FOREIGN KEY (bookId) REFERENCES books(id)
    );

    CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      bookId TEXT NOT NULL,
      name TEXT NOT NULL,
      appearance TEXT,
      powerLevel TEXT,
      skills TEXT,          -- JSON array
      relationships TEXT,   -- JSON array
      backstory TEXT,
      imageUrl TEXT,
      FOREIGN KEY (bookId) REFERENCES books(id)
    );

    CREATE TABLE IF NOT EXISTS ai_cache (
      bookId TEXT NOT NULL,
      cacheKey TEXT NOT NULL,  -- e.g. "summary", "power_system", "tags"
      content TEXT NOT NULL,
      createdAt INTEGER,
      PRIMARY KEY (bookId, cacheKey)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS book_content_fts
      USING fts5(bookId, chapterIndex, content);
  `);
}

// Books
export function saveBook(book: Omit<Book, "id">): string {
  const id = `book_${Date.now()}`;
  db.runSync(
    `INSERT INTO books (id, title, author, filePath, genre, tags, addedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, book.title, book.author ?? "", book.filePath, book.genre ?? "", JSON.stringify(book.tags ?? []), Date.now()]
  );
  return id;
}

export function getAllBooks(): Book[] {
  return db.getAllSync<Book>("SELECT * FROM books ORDER BY addedAt DESC");
}

export function updateBookPosition(bookId: string, position: ReadingPosition): void {
  db.runSync(
    "UPDATE books SET lastPosition = ? WHERE id = ?",
    [JSON.stringify(position), bookId]
  );
}

// Bookmarks
export function addBookmark(bookmark: Omit<Bookmark, "id">): void {
  db.runSync(
    `INSERT INTO bookmarks (id, bookId, chapterIndex, scrollY, highlight, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [`bm_${Date.now()}`, bookmark.bookId, bookmark.chapterIndex, bookmark.scrollY, bookmark.highlight ?? "", bookmark.note ?? "", Date.now()]
  );
}

export function getBookmarks(bookId: string): Bookmark[] {
  return db.getAllSync<Bookmark>(
    "SELECT * FROM bookmarks WHERE bookId = ? ORDER BY createdAt DESC",
    [bookId]
  );
}

// AI cache — only analyze once, reuse forever
export function getAICache(bookId: string, key: string): string | null {
  const row = db.getFirstSync<{ content: string }>(
    "SELECT content FROM ai_cache WHERE bookId = ? AND cacheKey = ?",
    [bookId, key]
  );
  return row?.content ?? null;
}

export function setAICache(bookId: string, key: string, content: string): void {
  db.runSync(
    `INSERT OR REPLACE INTO ai_cache (bookId, cacheKey, content, createdAt)
     VALUES (?, ?, ?, ?)`,
    [bookId, key, content, Date.now()]
  );
}

// Full-text search
export function searchBooks(query: string) {
  return db.getAllSync(
    "SELECT bookId, chapterIndex, snippet(book_content_fts, 2, '<b>', '</b>', '...', 20) as snippet FROM book_content_fts WHERE content MATCH ?",
    [query]
  );
}

// Types
export interface Book {
  id: string;
  title: string;
  author?: string;
  filePath: string;
  coverUrl?: string;
  genre?: string;
  tags?: string[];
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

export interface ReadingPosition {
  chapterIndex: number;
  scrollY: number;
}
```

---

### 6. Zustand Store — `src/store/bookStore.ts`

```typescript
import { create } from "zustand";
import { Book, ReadingPosition } from "../services/db";

interface BookStore {
  currentBook: Book | null;
  currentChapter: number;
  readingPosition: ReadingPosition;
  tags: string[];

  setCurrentBook: (book: Book) => void;
  setChapter: (index: number) => void;
  setPosition: (pos: ReadingPosition) => void;
  setTags: (tags: string[]) => void;
  reset: () => void;
}

export const useBookStore = create<BookStore>((set) => ({
  currentBook: null,
  currentChapter: 0,
  readingPosition: { chapterIndex: 0, scrollY: 0 },
  tags: [],

  setCurrentBook: (book) => set({ currentBook: book }),
  setChapter: (index) => set({ currentChapter: index }),
  setPosition: (pos) => set({ readingPosition: pos }),
  setTags: (tags) => set({ tags }),
  reset: () => set({ currentBook: null, currentChapter: 0, tags: [] }),
}));
```

---

### 7. Tag → Music + Image Style Flow

```typescript
// src/hooks/useBookAI.ts
import { useEffect } from "react";
import { generateTags } from "../services/gemini";
import { playMusicForTags } from "../services/music";
import { getAICache, setAICache } from "../services/db";
import { useBookStore } from "../store/bookStore";

export function useBookAI(bookId: string, sampleText: string) {
  const setTags = useBookStore((s) => s.setTags);

  useEffect(() => {
    async function initAI() {
      // Check cache first — don't waste Gemini quota
      const cached = getAICache(bookId, "tags");
      if (cached) {
        const tags = JSON.parse(cached);
        setTags(tags);
        await playMusicForTags(tags);
        return;
      }

      // First time — call Gemini
      const tags = await generateTags(sampleText);
      setAICache(bookId, "tags", JSON.stringify(tags));
      setTags(tags);
      await playMusicForTags(tags);
    }

    initAI();
  }, [bookId]);
}
```

---

## Royalty-Free Music Sources

Download MP3s from these — all free, no attribution required:

| Source | URL | License |
|---|---|---|
| Pixabay Music | pixabay.com/music | Free, no credit needed |
| Free Music Archive | freemusicarchive.org | CC0 / CC-BY |
| ZapSplat | zapsplat.com | Free tier available |
| Incompetech | incompetech.com | CC-BY (credit in settings) |

Download ~20–30 short loops (60–180s), bundle in `assets/music/`.

---

## Build Order (8 weeks)

| Week | Feature | Notes |
|---|---|---|
| 1–2 | Import + Reader | EPUB first, PDF/DOCX after |
| 3–4 | TTS + Background music | expo-speech + expo-av |
| 5–6 | Gemini AI text features | Tags, summary, characters, word explainer |
| 7–8 | AI images + polish | Pollinations.ai, cover, character art |

**Rule:** Always check AI cache before calling Gemini. One book = one analysis = cached forever.

---

## Environment Variables

Create `.env` at project root:

```
EXPO_PUBLIC_GEMINI_KEY=your_gemini_api_key_here
```

Get free Gemini API key: [aistudio.google.com](https://aistudio.google.com)

---

## APK Build (Android only)

```bash
# Development
npx expo start --android

# Production APK (no Expo Go needed)
npx eas build --platform android --profile preview

# Local build (no EAS account)
npx expo run:android
```

---

## Vietnamese Language Support

App is Vietnamese-only for now. Four things to handle:

| Area | What to do | Effort |
|---|---|---|
| Gemini prompts | Add Vietnamese system context to every prompt | Simple |
| TTS | Lock to `vi-VN`, check availability on first launch | Simple |
| FTS Search | Normalize (strip diacritics) before indexing + searching | Medium |
| Image prompts | Translate VI → EN before calling Pollinations.ai | Simple |

### Gemini — System Context

Add this constant to `gemini.ts` and prepend to **every** prompt:

```typescript
// src/services/gemini.ts

const SYSTEM_CONTEXT = `
You are analyzing Vietnamese web novels and books.
- Input text is in Vietnamese
- Always respond in Vietnamese
- Character names may be Sino-Vietnamese (Hán Việt) e.g. "Tiêu Viêm", "Đường Tam"
- Power system terms are often transliterated Chinese: "Đấu Khí", "Võ Hoàng", "Thánh"
- Return all JSON string values in Vietnamese unless it is a proper noun
`;

// Usage — prepend to every prompt
const prompt = `${SYSTEM_CONTEXT}\n\n${yourPromptHere}`;
```

Why it matters: Gemini sometimes misidentifies Vietnamese-translated Chinese novels as Chinese, then returns results in Mandarin or pinyin instead of preserving the Hán Việt names as written in the source text.

### TTS — Lock to vi-VN + First-Launch Check

```typescript
// src/services/tts.ts

export async function checkVietnameseTTS(): Promise<boolean> {
  const voices = await Speech.getAvailableVoicesAsync();
  return voices.some((v) => v.language === "vi-VN");
}

// Call on app first launch — guide user if missing
export async function ensureVietnameseTTS(): Promise<void> {
  const available = await checkVietnameseTTS();
  if (!available) {
    // Show alert guiding user to install Vietnamese TTS
    Alert.alert(
      "Thiếu giọng đọc tiếng Việt",
      "Vào Cài đặt → Trợ năng → Chuyển văn bản thành giọng nói → Tải thêm giọng tiếng Việt.",
      [{ text: "Đã hiểu" }]
    );
  }
}

export function speak(text: string, options: TTSOptions = {}): void {
  Speech.speak(text, {
    language: "vi-VN", // Always hardcoded — never auto-detect
    rate: options.rate ?? 1.0,
    pitch: options.pitch ?? 1.0,
    voice: options.voice,
    // ...
  });
}
```

### FTS Search — Strip Diacritics Before Indexing

SQLite FTS5 does not understand Vietnamese diacritics by default — searching "nguyen" will not match "nguyễn". Fix by normalizing both stored content and search queries.

```typescript
// src/utils/text.ts

export function normalizeVietnamese(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip all diacritic marks
    .toLowerCase()
    .trim();
}
```

```typescript
// Updated FTS schema in db.ts — store both original and normalized
db.execSync(`
  CREATE VIRTUAL TABLE IF NOT EXISTS book_content_fts
    USING fts5(bookId, chapterIndex, content, content_normalized);
`);

// When indexing a chapter
export function indexChapter(
  bookId: string,
  chapterIndex: number,
  content: string
): void {
  db.runSync(
    `INSERT INTO book_content_fts (bookId, chapterIndex, content, content_normalized)
     VALUES (?, ?, ?, ?)`,
    [bookId, chapterIndex, content, normalizeVietnamese(content)]
  );
}

// When searching — normalize query too
export function searchBooks(query: string) {
  const normalized = normalizeVietnamese(query);
  return db.getAllSync(
    `SELECT bookId, chapterIndex,
            snippet(book_content_fts, 2, '[', ']', '...', 20) as snippet
     FROM book_content_fts
     WHERE content_normalized MATCH ?`,
    [normalized]
  );
}
```

### Pollinations.ai — Translate Description Before Image Prompt

Image generation models don't handle Vietnamese well — always build image prompts in English. Since Gemini extracts character info in Vietnamese, add a translation step:

```typescript
// src/services/imageAI.ts

async function translateToEnglish(vietnameseText: string): Promise<string> {
  const prompt = `
Translate this Vietnamese character description to English for image generation.
Return ONLY the translated text. No explanation. Keep proper nouns (character names) as-is.

Text: ${vietnameseText}
  `;
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

export async function generateCharacterImage(
  characterName: string,
  vietnameseAppearance: string, // from Gemini extraction
  genre: string
): Promise<string> {
  const englishAppearance = await translateToEnglish(vietnameseAppearance);
  const style = STYLE_MAP[genre] ?? "digital art, character portrait";
  const prompt = `${characterName}, ${englishAppearance}, ${style}, character portrait, full body, high quality`;
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=400&height=600&nologo=true`;
}
```

---

## Backend Decision: App-only vs Separate BE

**Verdict: App-only is enough for personal use.**

| | App-only | With Backend |
|---|---|---|
| Setup | Nothing needed | Server + deploy required |
| Cost | $0 | $0 if using free tier (Railway, Supabase) |
| Multi-device sync | ❌ | ✅ |
| Auto backup | ❌ | ✅ |
| Data lost if app deleted | ✅ yes | ✅ safe |
| Code complexity | Low | 2x higher |
| Fits this use case | ✅ | Overkill |

**Performance reality:**
- Gemini runs on the cloud — app only sends text and receives JSON, no heavy computation on device
- Chunking + merge logic is just string processing, runs once per volume import then done
- Full knowledge base for even the longest novel series = a few MB in SQLite, handled easily
- Import processing takes 3–5 min for a long volume, but runs in background — user can keep reading

**If you later want multi-device sync**, add Supabase (free tier: PostgreSQL + auth + realtime). No need to write your own server — just replace `expo-sqlite` reads/writes with Supabase client calls.

---

## Accumulative Knowledge Base (Multi-Volume Series)

### The Problem

Power systems in cultivation/fantasy novels reveal progressively across volumes. Volume 1 might show 3 stages; Volume 50 introduces 10 more plus sub-systems. Analyzing only one volume gives an incomplete picture. Users also import volumes one at a time, not all at once.

### Solution: Delta Extraction + Merge

Instead of re-analyzing the whole series each time, maintain a **knowledge base per series** that updates incrementally with each new volume import.

```
New volume imported
      ↓
Chunk by chapter (~3000 tokens each)
      ↓
Gemini: extract ONLY new info vs existing KB  ← feed existing KB into prompt
      ↓
hasChanges? → No → skip, save quota
             → Yes → merge delta into KB → save to SQLite
      ↓
UI reads updated KB: power system / characters / lore
```

**Key rule:** Always feed the existing knowledge base into the prompt and ask Gemini to return only what changed. If `hasChanges: false`, skip the merge call entirely — saves quota.

### Updated Project Structure

Add these files to `src/services/`:

```
src/services/
  ├── knowledgeBase.ts    # KB read/write helpers
  ├── seriesManager.ts    # Group volumes into series, detect new volume
  └── deltaExtractor.ts   # Chunk → Gemini delta → merge logic
```

### SQLite Schema Addition

Add to `db.ts` `initDB()`:

```typescript
db.execSync(`
  -- Group multiple volumes into one series
  CREATE TABLE IF NOT EXISTS series (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    totalVolumesImported INTEGER DEFAULT 0,
    lastUpdated INTEGER
  );

  -- Map each book/volume to a series
  CREATE TABLE IF NOT EXISTS book_series (
    bookId TEXT NOT NULL,
    seriesId TEXT NOT NULL,
    volumeNumber INTEGER,
    PRIMARY KEY (bookId, seriesId)
  );

  -- Power system stages — accumulate across volumes
  CREATE TABLE IF NOT EXISTS power_stages (
    id TEXT PRIMARY KEY,
    seriesId TEXT NOT NULL,
    stageName TEXT NOT NULL,
    rank INTEGER,
    description TEXT,
    subStages TEXT,               -- JSON array for sub-ranks
    discoveredAtVolume INTEGER,
    discoveredAtChapter INTEGER
  );

  -- Characters — current state only
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    seriesId TEXT NOT NULL,
    name TEXT NOT NULL,
    aliases TEXT,                 -- JSON: ["alt name", "title"]
    currentPower TEXT,
    faction TEXT,
    imageUrl TEXT,
    lastSeenVolume INTEGER,
    lastSeenChapter INTEGER
  );

  -- Character events — append only, never delete
  CREATE TABLE IF NOT EXISTS character_events (
    id TEXT PRIMARY KEY,
    characterId TEXT NOT NULL,
    seriesId TEXT NOT NULL,
    volume INTEGER,
    chapter INTEGER,
    eventType TEXT,               -- 'power_up' | 'relationship' | 'death' | 'reveal' | 'other'
    description TEXT,
    FOREIGN KEY (characterId) REFERENCES characters(id)
  );

  -- World lore — accumulate across volumes
  CREATE TABLE IF NOT EXISTS world_lore (
    id TEXT PRIMARY KEY,
    seriesId TEXT NOT NULL,
    category TEXT,                -- 'geography' | 'faction' | 'history' | 'rule' | 'other'
    title TEXT,
    content TEXT,
    discoveredAtVolume INTEGER
  );
`);
```

### 8. Delta Extractor — `src/services/deltaExtractor.ts`

```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as db from "./db";

const genAI = new GoogleGenerativeAI(process.env.EXPO_PUBLIC_GEMINI_KEY!);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

interface KnowledgeBase {
  powerStages: { name: string; rank: number; description: string }[];
  characters: { name: string; aliases: string[]; currentPower: string; faction: string }[];
  lore: string[];
}

interface Delta {
  hasChanges: boolean;
  newPowerStages?: { name: string; rank: number; description: string }[];
  updatedCharacters?: {
    name: string;
    powerChange?: string;
    newSkills?: string[];
    newRelationships?: { name: string; relation: string }[];
    event?: string;
    eventType?: "power_up" | "relationship" | "death" | "reveal" | "other";
  }[];
  newLore?: string;
}

// Split text into chunks by chapter boundary or token limit
function chunkText(text: string, maxChars = 8000): string[] {
  const chapters = text.split(/第.{1,10}章|Chapter \d+/i);
  const chunks: string[] = [];
  let current = "";

  for (const ch of chapters) {
    if ((current + ch).length > maxChars) {
      if (current) chunks.push(current.trim());
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// Load current KB from SQLite for a series
function loadKnowledgeBase(seriesId: string): KnowledgeBase {
  const powerStages = db.getPowerStages(seriesId);
  const characters = db.getCharacters(seriesId);
  const lore = db.getWorldLore(seriesId).map((l) => l.content);
  return { powerStages, characters, lore };
}

// Ask Gemini: given existing KB + new text, what's NEW?
async function extractDelta(
  existingKB: KnowledgeBase,
  chunkText: string,
  volumeNumber: number
): Promise<Delta> {
  const prompt = `
You are updating a story knowledge base. 

EXISTING KNOWLEDGE BASE (already known — do NOT repeat these):
${JSON.stringify(existingKB, null, 2)}

NEW TEXT FROM VOLUME ${volumeNumber}:
${chunkText}

Extract ONLY information not already in the knowledge base above.
Return ONLY valid JSON, no markdown, no explanation:

{
  "hasChanges": boolean,
  "newPowerStages": [
    { "name": "string", "rank": number, "description": "string" }
  ],
  "updatedCharacters": [
    {
      "name": "string",
      "powerChange": "string or null",
      "newSkills": ["string"],
      "newRelationships": [{ "name": "string", "relation": "string" }],
      "event": "what happened this chapter",
      "eventType": "power_up | relationship | death | reveal | other"
    }
  ],
  "newLore": "string or null"
}

If nothing new found, return: { "hasChanges": false }
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().replace(/```json|```/g, "").trim();
  return JSON.parse(text);
}

// Merge delta into SQLite
function mergeDelta(
  seriesId: string,
  delta: Delta,
  volumeNumber: number,
  chapterIndex: number
): void {
  // New power stages
  for (const stage of delta.newPowerStages ?? []) {
    db.insertPowerStage({
      seriesId,
      stageName: stage.name,
      rank: stage.rank,
      description: stage.description,
      discoveredAtVolume: volumeNumber,
      discoveredAtChapter: chapterIndex,
    });
  }

  // Updated characters
  for (const char of delta.updatedCharacters ?? []) {
    let characterId = db.findCharacter(seriesId, char.name);

    if (!characterId) {
      characterId = db.insertCharacter({
        seriesId,
        name: char.name,
        currentPower: char.powerChange ?? "",
        lastSeenVolume: volumeNumber,
        lastSeenChapter: chapterIndex,
      });
    } else if (char.powerChange) {
      db.updateCharacterPower(characterId, char.powerChange, volumeNumber, chapterIndex);
    }

    // Log the event
    if (char.event) {
      db.insertCharacterEvent({
        characterId,
        seriesId,
        volume: volumeNumber,
        chapter: chapterIndex,
        eventType: char.eventType ?? "other",
        description: char.event,
      });
    }
  }

  // New lore
  if (delta.newLore) {
    db.insertWorldLore({
      seriesId,
      category: "other",
      content: delta.newLore,
      discoveredAtVolume: volumeNumber,
    });
  }
}

// Main entry point — call this when a new volume is imported
export async function processNewVolume(
  seriesId: string,
  volumeNumber: number,
  fullText: string,
  onProgress?: (current: number, total: number) => void
): Promise<void> {
  const chunks = chunkText(fullText);
  const existingKB = loadKnowledgeBase(seriesId);

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(i + 1, chunks.length);

    const delta = await extractDelta(existingKB, chunks[i], volumeNumber);

    if (!delta.hasChanges) continue; // Nothing new — skip merge, save quota

    mergeDelta(seriesId, delta, volumeNumber, i);

    // Update local KB snapshot so next chunk sees the merged state
    if (delta.newPowerStages?.length) {
      existingKB.powerStages.push(...delta.newPowerStages);
    }
    if (delta.updatedCharacters?.length) {
      for (const c of delta.updatedCharacters) {
        const existing = existingKB.characters.find((ec) => ec.name === c.name);
        if (!existing) {
          existingKB.characters.push({
            name: c.name,
            aliases: [],
            currentPower: c.powerChange ?? "",
            faction: "",
          });
        } else if (c.powerChange) {
          existing.currentPower = c.powerChange;
        }
      }
    }
    if (delta.newLore) {
      existingKB.lore.push(delta.newLore);
    }
  }

  // Update series metadata
  db.updateSeriesVolumeCount(seriesId, volumeNumber);
}
```

### 9. Series Manager UX — `src/services/seriesManager.ts`

```typescript
import * as db from "./db";

// Called after user picks a file — ask if it belongs to an existing series
export function detectSeriesForBook(title: string): db.Series[] {
  // Return existing series as candidates (user picks or creates new)
  return db.getAllSeries();
}

export function assignBookToSeries(
  bookId: string,
  seriesId: string,
  volumeNumber: number
): void {
  db.insertBookSeries({ bookId, seriesId, volumeNumber });
}

export function createNewSeries(name: string): string {
  return db.insertSeries({ name, totalVolumesImported: 0 });
}
```

**UX prompt shown to user on each new import:**

```
"Does this belong to an existing series?"

  [Đấu Phá Thương Khung]   ← existing series detected by name similarity
  [Thánh Khư]
  [+ New series]
  [Standalone book]
```

If user picks an existing series → app auto-runs `processNewVolume()` in background with a progress indicator. User can keep reading while it processes.

### Build Order Update

| Week | Feature | Notes |
|---|---|---|
| 1–2 | Import + Reader | EPUB first, PDF/DOCX after |
| 3–4 | TTS + Background music | expo-speech + expo-av |
| 5–6 | Gemini AI — tags, summary, word explainer | Simpler AI features first |
| 7 | Series manager + delta extractor | Multi-volume KB logic |
| 8 | AI images + polish | Pollinations.ai cover + character art |