# Pocket Library — Build Progress

Living tracker for the build. Update the status box + checklists as work lands. See `docs/SPEC.md` for the design and `CLAUDE.md` for principles/conventions.

**Legend:** ⬜ todo · 🟡 in progress · ✅ done · ⏸️ blocked/deferred

---

## Current status

- **Phase:** 2 — Import + Reader → **feature-complete** (EPUB/DOCX/PDF import, reader, bookmarks, search). Only on-device boot verification remains.
- **Last updated:** 2026-06-30
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
- ⬜ `src/services/tts.ts` (expo-speech, vi-VN, ≤3000-char chunking, `isSpeakingAsync` fix, `ensureVietnameseTTS`)
- ⬜ `src/services/music.ts` (expo-audio, loop, vol ~0.2, single instance)
- ⬜ Source + bundle ~20–30 royalty-free MP3s in `assets/music/` ⏸️ (manual asset sourcing)
- ⬜ AudioPlayer UI + lock-screen/background config

### Phase 4 — Gemini text features (Wk 5–6)
- ⬜ `src/services/gemini.ts` (SYSTEM_CONTEXT vi, tags, summary, characters, explainWord, power system; strip ```json fences; cache-first)
- ⬜ `src/hooks/useBookAI.ts` (tags → music + cache flow)
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
- `Speech.isSpeakingAsync()` is async — spec's sync cast is wrong; fix in `tts.ts`.
- FTS5 must be populated per-chapter on import (not auto).
- MP3 assets need manual sourcing before `music.ts` is testable; `require()` per file.
- Background TTS on Android needs foreground service + lock-screen controls; verify `expo-speech` keeps playing backgrounded.
- expo-file-system v19: use new API; fall back to `/legacy` import for raw-string reads if needed.
- Gemini key required in `.env` (`EXPO_PUBLIC_GEMINI_KEY`) before any AI feature works.

## How to run
```bash
npx expo start --android      # dev (Expo Go)
npx expo run:android          # local native build
```
