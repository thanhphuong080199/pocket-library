# Pocket Library — Build Progress

Living tracker for the build. Update the status box + checklists as work lands. See `docs/SPEC.md` for the design and `CLAUDE.md` for principles/conventions.

**Legend:** ⬜ todo · 🟡 in progress · ✅ done · ⏸️ blocked/deferred

---

## Current status

- **Phase:** 3 — Audio → **TTS complete** (read-aloud wired into reader + settings). Remaining: background music (`music.ts`) blocked on MP3 assets; lock-screen/background config.
- **Last updated:** 2026-07-01
- **App boots in Expo Go:** not yet verified on-device; Metro bundle compiles. Library/Reader/Settings tabs + Search/Bookmarks screens wired.

### Key environment decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Expo SDK | **54** (`expo ~54.0.34`, expo-router ~6, RN 0.81.5, React 19.1) | SDK 56 has Expo Go issues; 54 tests on-device via Expo Go. |
| Persisted settings store | **`@react-native-async-storage/async-storage`** (NOT `react-native-mmkv`) | MMKV is a native module → **not available in Expo Go**. AsyncStorage works in Expo Go. Revisit if we move to a dev build. |
| Audio | **`expo-audio`** (NOT `expo-av`) | `expo-av` is deprecated/removed in SDK 54. |
| File reading | `expo-file-system` **v19 new API** (legacy API at `expo-file-system/legacy`) | SDK 54 reworked the FS API. |
| zustand | **v5** | Latest; minor API differences from spec's v4 samples. |
| Path alias | `@/*` → repo root (so services live at `@/src/services/...`) | Matches scaffold's tsconfig. |

> These deviate from CLAUDE.md's pinned intentions — CLAUDE.md updated to match.

---

## Phase checklist

### Phase 0 — Scaffold & setup ✅
- ✅ `create-expo-app` (SDK 54 template) merged into repo root
- ✅ Install deps: expo-sqlite, expo-file-system, expo-document-picker, expo-speech, expo-audio, react-native-webview, async-storage, zustand, @google/generative-ai
- ✅ Rename project (`package.json`, `app.json`)
- ✅ Baseline `tsc --noEmit` clean
- ✅ `.env` + `.env.example` + `EXPO_PUBLIC_GEMINI_KEY` typing (`env.d.ts`)
- ✅ `src/` directory structure (`services/ store/ constants/ utils/`)
- ✅ Remove scaffold demo files — deleted `modal` screen, `hello-wave`, `parallax-scroll-view`, `external-link`, `haptic-tab`, `themed-text/view`, `ui/collapsible`, `ui/icon-symbol*`, `use-theme-color`, root `constants/theme.ts` (+ empty `components/`, `constants/`). Kept `hooks/use-color-scheme*` (used by root layout).
- ⏸️ Android config for background audio (foreground service) — deferred to Phase 3

### Phase 1 — Foundation (DB, types, stores, constants) ✅
- ✅ `src/services/db.ts` — schema (books, bookmarks, characters, ai_cache, FTS5 + normalized col, series/KB tables), sync API, CRUD helpers (+ `getChapters` added in Phase 2)
- ✅ `src/utils/text.ts` — `normalizeVietnamese()` + `splitIntoChunks()`
- ✅ `src/store/bookStore.ts` (zustand v5)
- ✅ `src/store/audioStore.ts`
- ✅ `src/store/settingsStore.ts` (persist via AsyncStorage: theme, font, voice, rate)
- ✅ `src/constants/musicMap.ts` (tag → MP3) + `styleMap.ts` (genre → image style)
- ✅ `initDB()` called on app launch (`app/_layout.tsx`)

### Phase 2 — Import + Reader (Wk 1–2)
- ✅ `src/services/epub.ts` — **JSZip-based text extraction** (NOT epub.js/WebView; we need plain text for reader/TTS/AI/FTS). Walks OPF spine, strips XHTML, extracts cover.
- ✅ `src/services/docx.ts` — JSZip + OOXML `<w:t>` text extraction (whole doc = 1 chapter).
- ✅ `src/services/pdf.ts` — pdf.js in a **hidden WebView** (`components/PdfExtractorHost` + `services/pdfBridge.ts`), mounted once at app root. Per-page text → chapters; scanned/image-only PDFs error out clearly. pdf.js (v3 UMD) loads from CDN, so PDF import needs network on first use. ⚠️ Needs on-device verification (WebView message bridge + CDN can't be exercised from the bundler).
- ✅ `src/utils/html.ts` — shared HTML/XML → text (`htmlToText`, `decodeEntities`).
- ✅ `src/services/parseTypes.ts` — `ParsedBook` shape + `ParseError`.
- ✅ Import flow (`src/services/import.ts`): DocumentPicker → copy into `documents/books/` → parse → `saveBook` + standalone 1-vol series → `indexChapter` per chapter (FTS).
- ✅ `db.getChapters(bookId)` — chapters rehydrate from FTS `content` column (single source of truth, no re-parse).
- ✅ Library screen (`app/(tabs)/index.tsx`) — 2-col grid, cover/fallback, import w/ spinner, tap-to-open, long-press delete.
- ✅ Reader screen (`app/(tabs)/reader.tsx`) — themed `<Text>`, font size/family/line-height from settings, chapter nav, scroll-position persist+resume, bookmark.
- ✅ Settings screen (`app/(tabs)/settings.tsx`) — theme swatches, font family, font-size/line-spacing steppers, live preview.
- ✅ Tabs reworked to Library / Reader / Settings (demo `explore` removed); jszip added.
- ✅ Bookmarks list/jump UI (`app/bookmarks.tsx`) — list per book, tap to jump (via `bookStore.jumpTo` + `pendingScrollY`), swipe-free delete. Opened from the reader's list icon.
- ✅ FTS5 **search UI** (`app/search.tsx`) — debounced cross-book search, bracket-highlighted snippets, tap to open at chapter. `searchContent` hardened to tokenize into safe prefix terms (avoids FTS5 operator-injection syntax errors).
- ✅ Reader resume/jump reworked: `bookStore.pendingScrollY` one-shot scroll consumed after layout (works while the reader tab stays mounted).
- ⬜ On-device boot verification in Expo Go (whole app, incl. PDF path).

### Phase 2.5 — Reader UX revamp (on-device feedback) ✅ (pending device re-test)
First on-device test (import + basics work). Reworked the reading experience:
- ✅ **Chapter titles captured at import.** Parsers return `ParsedChapter{title,content}[]`; EPUB title from nav/`toc.ncx` (resolved relative to the TOC file) or first heading/`<title>` (fallback "Chapter N"), DOCX = book title, PDF = "Page N". `books.chapterTitles` (JSON) + `bookmarks.paragraphIndex` columns added directly to the `CREATE TABLE` schema (no migration — pre-release, local-only; wipe app data to recreate the DB).
- ✅ **Book detail page** (`app/book/[id].tsx`) — new landing screen on tapping a book (Library no longer opens the reader directly). Sections: cover+title/author, Start/Continue button, Tags (placeholder or real if present), Story summary / Power system / Character profiles (labeled placeholders for Phases 4–5), **real chapter index**, plus Search-inside + Bookmarks icons. Loads book into reader context on mount.
- ✅ **Chapter index / TOC in reader** — list icon in reader top bar → `app/chapters.tsx` (titles, current highlighted with ▶, tap = `jumpTo`). Detail page embeds its own inline chapter index.
- ✅ **Search split:** Library search = **title + author filter only** (inline `TextInput`, client-side). Content/FTS search moved **inside a book** — `app/search.tsx` takes a `bookId` param (placeholder + row labels adapt); `db.searchContent(query, bookId?)` gained the optional filter; reached from the detail page's search icon.
- ✅ **Paragraph-level bookmarks.** Reader renders each chapter as `<Pressable><Text>` paragraphs (split on blank line, fallback single newline). Long-press a paragraph **or** tap the bookmark icon (bookmarks the topmost visible paragraph) → saves `paragraphIndex` + excerpt (in `highlight`). `bookStore.jumpToParagraph` + `pendingParagraph` scroll to the paragraph's measured `onLayout` offset (works even when chapter must change first). Bookmark list shows the excerpt.
- Decisions: Reader **stays a bottom tab**; detail/chapters/search/bookmarks are pushed screens. Nav: Library → Detail → Reader.
- ⚠️ All verified by tsc + lint + Android bundle; **needs on-device re-test** (esp. paragraph offset accuracy + jump precision).

### Phase 3 — Audio (Wk 3–4)
- ✅ `src/services/tts.ts` (expo-speech, vi-VN hard-locked, ≤3000-char chunking chained via `onDone`, async `isSpeaking()` fix, `checkVietnameseTTS`/`ensureVietnameseTTS`, `getVietnameseVoices`). Owns a single playback session (module state) + mirrors lifecycle into `audioStore`. **Pause/resume simulated** (Android has no native `Speech.pause`): pause stops + keeps a chunk cursor, resume re-speaks from the current chunk (sentence-group boundary). `sessionId` guard ignores stale `onDone` after stop/pause/new-speak.
- ✅ TTS is **segment (paragraph) based**: `speak(segments, startIndex, opts, callbacks)` takes the same paragraph array the reader renders and reports the active paragraph via `onSegment` (a paragraph over 3000 chars is sub-chunked but reported under one index). Store tracks `ttsSegment`/`ttsTotalSegments`.
- ✅ Reader read-aloud wired (`app/(tabs)/reader.tsx`): play/pause + stop in top bar, reads current chapter, **auto-advances to next chapter** on finish (via `speakChapterRef`), stops on tab blur/unmount and on manual chapter nav. Uses persisted `ttsRate`/`ttsPitch`/`ttsVoice`. `ensureVietnameseTTS()` fires once when starting.
- ✅ **Read-along UX:** the paragraph being read is highlighted + auto-scrolled into view; a **seekable progress bar** (`TtsProgress`, by paragraph) sits above the nav — tap/drag to jump TTS to any paragraph (previews while dragging, commits on release). No new deps (custom touch-responder bar).
- ✅ Settings "Read-aloud" section — Speed + Pitch steppers (persisted `ttsRate`/`ttsPitch`) + vi-VN install hint.
- ✅ **Boilerplate/ad stripping** at import (`src/utils/clean.ts` → wired in `import.ts`): (1) cross-chapter repeated short lines = headers/footers → removed (needs ≥4 chapters, ≥60% frequency); (2) per-line ad phrases (truyenfull, "đọc truyện tại", telegram/fb, "nguồn:", …) drop the line; URLs are stripped in place so prose ending in a link survives. Conservative to avoid nuking content; cleans FTS-indexed text once at import (re-import to clean existing books). Unit-tested standalone on VN web-novel sample.
- ✅ `src/services/music.ts` (expo-audio, single looping `AudioPlayer`, vol ~0.2). `playForTags(tags)` picks a bundled loop via MUSIC_MAP→MUSIC_SOURCES (random among candidates; neutral default when tags don't map); `pause/resume/stopMusic`, `setMusicVolume`, `isMusicAvailable()`. Audio mode = `mixWithOthers` + `playsInSilentMode` so it sits under TTS. All entry points guarded (audio failures warn, never crash).
- ✅ Source + bundle **22** royalty-free MP3s in `assets/music/` — compressed with ffmpeg (≤90s, mono, 96kbps, metadata stripped): **95M→21M total**. MUSIC_SOURCES wired (literal `require()` per file).
- ✅ Music toggle in reader top bar (`app/(tabs)/reader.tsx`) — musical-notes icon, plays a loop from the current book's tags, stops on screen blur/unmount. Shown only when `isMusicAvailable()`.
- ⬜ Standalone AudioPlayer UI (volume slider / track label) + lock-screen/background config (foreground service; deferred from Phase 0).
- ⚠️ TTS verified by tsc + lint only; **needs on-device test** (needs a device vi-VN voice; pause/resume restart-chunk behavior; chapter auto-advance).

### Phase 4 — Gemini text features (Wk 5–6)
- 🟡 `src/services/gemini.ts` — client + **auto-tagging** done. SYSTEM_CONTEXT (vi), `extractJson` (strips ```json fences + slices first {}/[] block), `isGeminiConfigured()` (soft-fails when key absent/placeholder), `generateTags()` (closed `ALLOWED_TAGS` vocab = MUSIC_MAP keys, validated/deduped/≤4). **Model: `gemini-3.5-flash`** (⚠️ spec's `gemini-1.5-flash` was SHUT DOWN in 2026 → 404; Pro models now paid-only, Flash stays free ~15 RPM/1500 RPD). **Multi-model fallback:** `MODELS` = [3.5-flash, 2.5-flash, 3.1-flash-lite]; on 429/5xx/network it falls through to the next (per-model free quota buckets) with per-model cooldowns; non-retryable (400/401/403) surfaces immediately. Remaining: summary, characters, explainWord, power system.
- 🟡 `src/hooks/useBookAI.ts` — **tags** cache-first flow done (`buildTagSample`: head+mid chapters ≤6000 chars; `generate`/`regenerate`; writes `ai_cache` + `books.tags` + bookStore). Music wiring deferred (music.ts not written yet — user sequenced auto-tag before music). Summary/characters TODO.
- ✅ Auto-tag UI wired into **book detail page** (`app/book/[id].tsx`): Tags section shows AI tags + "Generate/Re-generate tags with AI" button (spinner while loading, error line on failure). Manual trigger (not auto-on-open) to protect quota. Missing key falls through the normal error path (no dedicated hint — key is expected present).
- ⬜ AIPanel UI (summary, character cards)
- ⬜ Long-press word → explainer popup

### Phase 5 — Series / Knowledge Base (Wk 7)
- ⬜ `src/services/knowledgeBase.ts`, `seriesManager.ts`, `deltaExtractor.ts`
- ⬜ Series-assign UX on import; background `processNewVolume()` w/ progress
- ⬜ `app/character/[id].tsx`

### Phase 6 — AI images + polish (Wk 8)
- ⬜ `src/services/imageAI.ts` (Pollinations URLs, vi→en translate step)
- ⬜ Book covers + character art
- ⬜ Settings screen polish, theme/font, TTS voice picker

---

## Open questions / gotchas (carry forward)

### Live (unresolved)
- ~~**MP3 assets** need manual sourcing before `music.ts` is testable.~~ ✅ 22 loops bundled + compressed; MUSIC_SOURCES wired; `music.ts` + reader toggle done. Music **auto-plays from a book's tags**, so it pairs with Phase 4 auto-tagging. Not yet verified on-device (needs the CI/dev build).
- **Background TTS on Android** needs a foreground service + lock-screen controls; verify `expo-speech` keeps playing backgrounded. Nothing configured in `app.json` yet — belongs with the AudioPlayer work.
- **Gemini key** required in `.env` (`EXPO_PUBLIC_GEMINI_KEY`) before any AI feature works. Standing Phase 4 prerequisite — `.env.example` + `env.d.ts` typing exist; real `.env` must be added by the user. App soft-fails without it (`isGeminiConfigured()` → false, AI UI shows an "add key" hint).
- **Gemini model IDs drift** — verified July 2026: `gemini-1.5-flash`/1.0 are **shut down (404)**, Pro models are **paid-only**. Use free Flash: default `gemini-3.5-flash` with fallback to `gemini-2.5-flash`, `gemini-3.1-flash-lite` (`MODELS` in `gemini.ts`). Re-verify before assuming any pinned model still exists.

### Resolved
- ~~`Speech.isSpeakingAsync()` is async — spec's sync cast is wrong; fix in `tts.ts`.~~ ✅ Fixed — `tts.ts` `isSpeaking()` returns the promise directly (no cast).
- ~~FTS5 must be populated per-chapter on import (not auto).~~ ✅ Done — `import.ts` calls `indexChapter` per chapter → `INSERT INTO book_content_fts` (`db.ts`).
- ~~expo-file-system v19: use new API; fall back to `/legacy` import for raw-string reads if needed.~~ ✅ Settled — all parsers use the new `File`/`Directory`/`Paths` API; `/legacy` fallback never needed.

## How to run
```bash
npx expo start --android      # dev (Expo Go)
npx expo run:android          # local native build
```
