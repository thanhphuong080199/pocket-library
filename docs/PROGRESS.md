# Pocket Library — Build Progress

Living tracker for the build. Update the status box + checklists as work lands. See `docs/SPEC.md` for the design and `CLAUDE.md` for principles/conventions.

**Legend:** ⬜ todo · 🟡 in progress · ✅ done · ⏸️ blocked/deferred

---

## Current status

- **Phase:** 4 done + **Phase 5 KB engine** built, now **background + resumable**. Whole-book analysis (`deltaExtractor` + `kbRunner`) runs detached with an app-wide progress banner, big 300K chunks + JSON mode to dodge the rate limit, and **pause/auto-resume + checkpoint** so a rate-limit or app-close doesn't lose progress. **Pending on-device test.** Remaining Step B: series-assign import UX, `character/[id]` screen, cross-volume series view.
- **2026-07-02 — bug-fix + player UX round (verified on emulator with a real EPUB):**
  - **Fixed chapter-nav crash:** `TtsForegroundService.onStartCommand` now calls `startForeground()` unconditionally before dispatching (every `startForegroundService()` start must, even ACTION_STOP — skipping it kills the app); `tts.stop()` no longer spins up the service when idle.
  - **Fixed silent first Play tap + ignored voice settings:** speak requests that race the async TTS engine init are stored (`pendingStart`) and replayed from the init callback; rate/pitch/voice are service fields applied inside `speakFrom()` so resume/replay/skip all honor them.
  - **Live TTS options:** new native `ACTION_SET_OPTIONS` (re-speaks current sentence with new rate/pitch/voice) + `ACTION_SKIP` (±1 sentence chunk; while paused just moves the cursor). JS: `tts.setOptions/skipSentence`, `playback.nextSentence/prevSentence/applyTtsOptions` (400ms debounce). Settings-tab steppers also live-apply.
  - **Player bar:** collapsible (pill bottom-left, mirrors KB banner's bottom-right pill), hosts the paragraph seek bar (moved out of the reader), sentence prev/next on tap + chapter on long-press, inline speed/pitch steppers + vi-VN voice picker (scroll-capped list).
  - **Reader:** bookmarked paragraphs get a left accent bar (loaded per chapter on focus); seek bar removed.
  - **Analysis banner:** explicit Cancel writes checkpoint status `cancelled` → no rehydrate on relaunch (rate-limit/app-kill still rehydrate); book detail Resume still works.
- **Last updated:** 2026-07-02
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
| Audio build target | **Dev build** (`expo run:android` / EAS), NOT Expo Go | Read-aloud + background audio use the custom native module `modules/pocket-tts` (TTS foreground service) + `expo-audio` background playback — native code Expo Go can't load. Non-audio features still run in Expo Go. |

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
- ✅ TTS is **segment (paragraph) based**: `speak(segments, startIndex, opts, callbacks)` takes the same paragraph array the reader renders and reports the active paragraph via `onSegment`. Store tracks `ttsSegment`/`ttsTotalSegments`.
- ✅ **Speech cleanup + prosody** (feedback 2026-07-01: engine read punctuation aloud, sounded monotone). `sanitizeForSpeech()` (`src/utils/text.ts`) strips decorative symbols/quotes/brackets and turns ellipses/dashes into a comma-pause before speaking (display text untouched). Utterance size dropped **3000 → 280 chars** (`MAX_CHUNK`) so each `Speech.speak` is ~1–3 sentences → the engine resets sentence intonation + inserts a natural pause between them (`splitIntoChunks` never cuts mid-sentence). **Bugfix (2026-07-01):** `splitIntoChunks`'s trailing-fragment branch was `\s*\S+\s*$`, which captured only the **last word** of any text without terminal `.?!` — so an unpunctuated line (e.g. `…"CLB-về-nhà" điển hình`) got read as just "hình", and mixed text dropped words. Fixed to `[^.!?。！？]+$` (whole remainder). NB: true emphasis/SSML isn't exposed by `expo-speech` (would need a native module — out of scope); these are the available prosody levers alongside `ttsRate`/`ttsPitch`.
- ✅ Reader read-aloud wired (`app/(tabs)/reader.tsx`): play/pause + stop in top bar, reads current chapter, **auto-advances to next chapter** on finish (via `speakChapterRef`), stops on tab blur/unmount and on manual chapter nav. Uses persisted `ttsRate`/`ttsPitch`/`ttsVoice`. `ensureVietnameseTTS()` fires once when starting.
- ✅ **Read-along UX:** the paragraph being read is highlighted + auto-scrolled into view; a **seekable progress bar** (`TtsProgress`, by paragraph) sits above the nav — tap/drag to jump TTS to any paragraph (previews while dragging, commits on release). No new deps (custom touch-responder bar).
- ✅ Settings "Read-aloud" section — Speed + Pitch steppers (persisted `ttsRate`/`ttsPitch`) + vi-VN install hint.
- ✅ **Boilerplate/ad stripping** at import (`src/utils/clean.ts` → wired in `import.ts`): (1) cross-chapter repeated short lines = headers/footers → removed (needs ≥4 chapters, ≥60% frequency); (2) per-line ad phrases (truyenfull, "đọc truyện tại", telegram/fb, "nguồn:", …) drop the line; URLs are stripped in place so prose ending in a link survives. Conservative to avoid nuking content; cleans FTS-indexed text once at import (re-import to clean existing books). Unit-tested standalone on VN web-novel sample.
- ✅ `src/services/music.ts` (expo-audio, single looping `AudioPlayer`, vol ~0.2). `playForTags(tags)` picks a bundled loop via MUSIC_MAP→MUSIC_SOURCES (random among candidates; neutral default when tags don't map); `pause/resume/stopMusic`, `setMusicVolume`, `isMusicAvailable()`. Audio mode = `mixWithOthers` + `playsInSilentMode` so it sits under TTS. All entry points guarded (audio failures warn, never crash).
- ✅ Source + bundle **22** royalty-free MP3s in `assets/music/` — compressed with ffmpeg (≤90s, mono, 96kbps, metadata stripped): **95M→21M total**. MUSIC_SOURCES wired (literal `require()` per file).
- ✅ Music toggle in reader top bar (`app/(tabs)/reader.tsx`) — musical-notes icon, plays a loop from the current book's tags, stops on screen blur/unmount. Shown only when `isMusicAvailable()`.
- ✅ **Background audio + standalone player** (built 2026-07-01; **requires a dev build**, see below). Read-aloud + music now play **app-wide** and survive leaving the reader / backgrounding / lock:
  - **Custom native TTS foreground service** — new local Expo module **`modules/pocket-tts`** (Kotlin) drives the platform `TextToSpeech` engine inside a `mediaPlayback` foreground service with a `MediaSessionCompat` lock-screen card (play/pause/stop/next/prev). Utterance chaining is **native**, so playback no longer dies when Android freezes the JS thread on background/lock. `src/services/tts.ts` was rewritten to drive this module (same public API — sanitize + `splitIntoChunks` still done in JS, flat chunk list handed to native; events → `audioStore`). Chapter next/prev from the lock screen emit `onRemoteCommand` → JS `playbackSession` changes chapter.
  - **Screen-independent playback** — `src/services/playbackSession.ts` owns "speak chapter + auto-advance" (moved out of the reader). Reader no longer stops audio on blur; `app/(tabs)/reader.tsx` delegates play/seek to the session.
  - **Standalone player bar** — `src/components/AudioPlayerBar.tsx` (mounted in `app/_layout.tsx`) floats on every screen when audio is active: now-playing book/chapter, prev/play-pause/next/stop, music toggle + a **volume slider** (touch-responder, no slider dep). `audioStore` gained `bookTitle/chapterTitle/chapterIndex/totalChapters`.
  - **Music background** — `["expo-audio", { enableBackgroundPlayback: true }]` in `app.json` (FGS perms); music keeps `mixWithOthers`/`shouldPlayInBackground` and ducks under the TTS focus. No second lock-screen card (music never calls `setActiveForLockScreen`).
- ⚠️ Verified by tsc + lint only; **needs on-device test on a dev build** (vi-VN voice; background/lock continuation; lock-screen buttons; music ducking; OEM battery-optimizer behavior — see Open questions).

### Phase 4 — Gemini text features (Wk 5–6) ✅ (pending on-device test)
- ✅ `src/services/gemini.ts` — client + all text features. SYSTEM_CONTEXT (vi), `extractJson` (strips ```json fences + slices first {}/[] block), `isGeminiConfigured()` (soft-fails when key absent/placeholder). Features: `generateTags()` (closed `ALLOWED_TAGS` vocab = MUSIC_MAP keys, validated/deduped/≤4), `generateSummary()` (plain-text vi summary), `extractPowerSystem()` (plain text; `"none"` sentinel → `""`), `extractCharacters()` → `CharacterProfile[]` (`{characters:[…]}` JSON, validated/name-deduped/≤8, defensive `str`/`strArray`/`relArray`), `explainWord(word, context)` (≤3-sentence vi). **Model: `gemini-3.5-flash`** (⚠️ spec's `gemini-1.5-flash` was SHUT DOWN in 2026 → 404; Pro models now paid-only, Flash stays free ~15 RPM/1500 RPD). **Multi-model fallback:** `MODELS` = [3.5-flash, 2.5-flash, 3.1-flash-lite]; on 429/5xx/network it falls through (per-model free quota buckets) with per-model cooldowns; non-retryable (400/401/403) surfaces immediately.
- ✅ `src/hooks/useBookAI.ts` — refactored to a **generic cache-first multi-feature hook** (`useAIFeature<T>`): returns `{ tags, summary, power, characters }`, each an `AIFeature<T>` = `{ data, status, error, generate, regenerate }`. Every feature **auto-hydrates from `ai_cache` on open** (free — no Gemini call) and only calls Gemini on explicit `generate` (cache-miss) / `regenerate` (force). `ai_cache` keys: `tags` / `summary` / `power_system` / `characters`. Tags also mirror into `books.tags` + bookStore (→ music). `buildSample()` spreads start/mid/¾ chapters (tags ≤6000, deeper analyses ≤12000 chars).
- ✅ Detail page (`app/book/[id].tsx`) AI sections via reusable `AISection` (loaded/loading/error/empty states + Generate/Re-generate button per feature; all manual-trigger to protect quota) — Tags, Story summary, Power system, Character profiles (`CharacterCard`). Cached results show on open with no button press.
- ✅ **Word/phrase explainer** in reader (`app/(tabs)/reader.tsx`): a "language" toggle in the top bar enables **define mode** — each word becomes a tappable nested `<Text>` (long-press still bookmarks). **Phrase selection (2026-07-01):** tap the **first word then the last word** of a phrase to select an inclusive range (anchor = first tap; later taps in the same paragraph move the other end, min/max so direction-agnostic); a single tap selects one word. Selected words highlight (translucent orange) and a **floating "Explain" bar** shows the phrase `「…」` + ✕ (clear) + Explain — the AI call is deferred until Explain is tapped (VN meaning usually lives in the phrase, not a single word). Explain opens a `WordExplainer` modal calling `explainWord(term, context)`, **cached per term** (book-scoped `ai_cache` key `word_<lc>`; phrase keys just as valid). Selection is scoped to one paragraph (= the context sent) and clears on chapter change / leaving define mode. `tokenize()`/`phraseFromSelection()` helpers preserve exact spacing/punctuation on re-join. Off by default so reading/TTS/bookmark gestures are unchanged. Note: native OS "Copy"-menu integration isn't possible for RN core `<Text>` without a native module, so this tap-range flow is the light-weight equivalent.
- ⚠️ All verified by tsc + lint only; **needs on-device test** (real Gemini key + JSON-shape robustness on live model output).
- 🧪 **On-device feedback (2026-07-01):** summary is good; **power system too shallow**, **characters too brief** — want a structured `Name/Gender/Power/…` format, both more detailed, spoilers OK. Root cause: analyses run on a **~12K-char / 3-chapter sample**, not the whole book (later-chapter depth never sent). **Decision: read the whole book, chunked, and route power + characters through the unified KB engine (see Phase 5). Summary stays sampled.** So Phase-4 `extractPowerSystem`/`extractCharacters` are **superseded by the KB engine** and will be removed from the detail-page flow; `generateSummary` + `generateTags` stay.

### Phase 5 — Accumulative Knowledge Base (multi-volume series) (Wk 7)
> Full design + reference code: **SPEC.md § "Accumulative Knowledge Base"** (lines ~848–1206). The idea: maintain **one knowledge base per series** that grows incrementally as each volume is imported — feed the *existing* KB into the prompt and ask Gemini for **only the delta** (new power stages, character power-ups/skills/relationships/events, new lore). `hasChanges:false` → skip merge, save quota. This is the series-scoped, cross-volume system; it is **separate** from Phase 4's one-shot book-scoped `extractCharacters` (which just caches a character list in `ai_cache` for the detail page).

**Storage is already done** — Phase 1 built the full series-scoped schema + CRUD (a *superset* of the spec's tables), so Phase 5 writes **no new schema**:
- Tables: `series`, `book_series`, `power_stages`, `characters` (richer than spec: `aliases`, `appearance`, `currentPower`, `faction`, `skills`, `relationships`, `backstory`, `imageUrl`, `lastSeen{Volume,Chapter}`), `character_events`, `world_lore`.
- Helpers exist: `insertSeries`/`getAllSeries`/`getSeries`/`updateSeriesVolumeCount`, `insertBookSeries`/`getSeriesIdForBook`/`getBooksInSeries`, `insertPowerStage`/`getPowerStages`, `insertCharacter`/`findCharacter`/`getCharacters`/`getCharacter`/`updateCharacterPower`/`updateCharacterImage`, `insertCharacterEvent`/`getCharacterEvents`, `insertWorldLore`/`getWorldLore`.

**Decisions locked (2026-07-01):** (1) analyses read the **whole book, chunked** (not a sample); (2) **one unified engine** serves both the Phase-4 depth fix and multi-volume accumulation — power + characters + lore go into the **series-scoped tables**, and the detail page reads the KB (not `ai_cache`); (3) use **large chunks (~150K chars)** to minimize call count (the delta trick saves cost *across volumes/re-runs*, NOT on a single book's first read — first read is ~1 call/chunk regardless, so few-big-chunks is the real single-book lever); (4) **summary + tags stay sampled** in `ai_cache` (cheap, already good).

**Build order — Step A (the depth fix) ✅ (pending on-device test):**
- ✅ `src/services/deltaExtractor.ts` — `chunkChapters(chapters, ~150K)` (whole-book, chapter-boundary-preserving; oversized single chapter → its own chunk) → in-memory `KBSnapshot` → `extractDelta` (routes through `gemini.runPrompt` + `extractJson`, Vietnamese structured delta prompt: power tiers + full character schema + lore, spoilers OK) → `mergeDelta` (dedup power stages by name; insert-or-enrich characters with **array union** for skills/aliases/relationships, scalar overwrite only when non-empty; append `character_events`; add lore) → `processVolume(seriesId, volume, chapters, onProgress)`. Snapshot updated per chunk so later chunks don't re-report; `hasChanges:false` skips the merge; `updateSeriesVolumeCount` at end. Local JSON validators (`str`/`strArray`/`relArray`/`cleanPowerStages`/`cleanCharacters`).
- ✅ `src/services/knowledgeBase.ts` — `getSeriesKB(seriesId)` (power stages rank-ordered + characters + lore) + `isKBEmpty`.
- ✅ `db.ts` — added `gender`/`role`/`personality`/`status` columns to `characters` (direct in `CREATE TABLE`, no migration — wipe/recreate); extended `Character` + `insertCharacter`; added `updateCharacter(id, partial)` (whitelist, JSON-encodes arrays), `clearSeriesKB(seriesId)`, `getBookVolume(bookId)`.
- ✅ `gemini.ts` — exported `runPrompt` (was `callGemini`) for the engine; **removed** `extractPowerSystem` + `extractCharacters` + `CharacterProfile` (superseded); kept `generateSummary`/`generateTags`/`explainWord`.
- ✅ `src/hooks/useSeriesKB.ts` — loads KB on open (free), `analyze()` (incremental) / `reanalyze()` (wipe + rebuild), exposes `progress` (chunk i/N). `useBookAI` trimmed to tags + summary only.
- ✅ `app/book/[id].tsx` — "Story analysis" section: single **Analyze/Re-analyze full book** button with live `chunk i/N` progress; Power system + Character profiles read from the KB. `CharacterCard` = labeled `Giới tính/Vai trò/Sức mạnh/Thế lực/Biệt danh/Kỹ năng/Quan hệ/Tính cách/Trạng thái/Ngoại hình/Lai lịch`; `PowerStageRow` for tiers. **Collapsible sections** (feedback 2026-07-01): `Section`/`AISection` gained `collapsible`+`initialCollapsed` (tappable header + chevron); Story summary / Power system / Character profiles / Chapters default **collapsed** so the page isn't a wall of text (Tags + the Analyze control stay open).
- ⚠️ tsc + lint clean; **needs on-device test** — real Gemini key, whole-book pass timing/quota on a long book, and JSON-shape robustness of the delta on live output. Uses each book's existing standalone series (no import-UX change yet).

**Build order — Step B (Phase-5 UX, right after; engine already supports it):**
- ⬜ `src/services/seriesManager.ts` — `createSeries(name)`, `assignBookToSeries(bookId, seriesId, vol)`, `getSeriesCandidates()` (positional DB API).
- ⬜ Series-assign UX on import ("New series / add to existing (+ volume #) / standalone"), then `processVolume()` with progress while the user keeps reading.
- ⬜ `app/character/[id].tsx` — character profile: accumulated current state + `character_events` timeline.
- ⬜ Series view surfacing the full KB (power ladder, character roster, lore) across volumes.
- ✅ **Background-ify the analysis + resume** (built 2026-07-01, after hitting the rate limit on a big book). Reading/TTS/music keep working during a run (network-I/O-bound; audio is native). Pieces:
  - **Bigger chunks** — `CHUNK_CHARS` 150K → **300K** + **JSON response mode** (`responseMimeType`) and a raised `maxOutputTokens` on the delta call, so far fewer requests (the free tier caps *requests/minute*, ~10–15). `runPrompt(prompt, opts)` gained `{ json, maxOutputTokens }`.
  - **Global background runner** — `src/services/kbRunner.ts` owns the chunk loop detached from any screen; `src/store/kbStore.ts` (zustand) mirrors job state; `src/components/KbProgressBanner.tsx` shows app-wide progress + Cancel/Resume/Dismiss on every screen. `useSeriesKB` rewritten to read the store (live per-chunk KB reload) + drive the runner. **Pacing** (`PACING_MS`) between chunks.
  - **Rate-limit = pause, not fail** — `GeminiRateLimitError` + `nextModelReadyInMs()` in `gemini.ts`; on "all models cooling down" the runner **pauses on the current chunk and auto-schedules a resume** once a model frees up (also manual Resume). Non-retryable errors surface but stay resumable.
  - **Checkpoint + resume** — `kb_analysis` table (`seriesId, bookId, volumeNumber, nextChunk, totalChunks, status`) saved **every chunk**; resume picks up from `nextChunk` (no re-spent quota, no `character_events` dup since replayed chunks are skipped). On launch, `hydrateInterrupted()` surfaces a left-over run as a **paused "Resume"** banner (does NOT auto-run → no surprise quota). `Re-analyze` still does a clean wipe.
  - ⚠️ Still foreground-bound: backgrounding the app likely suspends the JS fetch loop (same foreground-service gap as background TTS); the checkpoint means it resumes fine next foreground/launch.
  - ✅ **Responsive Cancel + minimizable banner** (feedback 2026-07-01: Cancel did nothing until the current big chunk finished; banner too tall). Cancel now **aborts the in-flight Gemini request** via `AbortSignal` (threaded `runPrompt` `opts.signal` → `extractDelta`/`processText` → `extractAndMergeChunk`; `kbRunner` owns an `AbortController`, aborts on cancel; the loop treats an aborted request as a **pause** on the current chunk, checkpoint kept). New `GeminiAbortError` (non-retryable — never falls through to other models; `processText` won't split-retry it). Banner gained a **minimize** chevron → collapses to a small corner pill (icon + `%`); `kbStore.minimized` (UI-only), reset to expanded when a fresh run starts.
- ✅ **Truncated-JSON resilience** (on-device 2026-07-01: "could not parse JSON from Gemini" during a dense chunk). Raised delta output cap 8192 → **16384**, and `extractAndMergeChunk` now **splits a chunk in half and retries** when the response won't parse (usually a truncated delta), down to a 20K-char floor / depth 4, skipping a fragment only as a last resort. Rate-limit errors still propagate to pause/resume (not split). So one oversized chunk degrades gracefully instead of failing the whole book.
- ✅ **Character dedup + aliases + ordering** (on-device feedback 2026-07-01: duplicate characters after a halfway stop; aliases). Merge now resolves a delta character by **name OR any alias** (case-insensitive, both directions — `resolveExistingName`) instead of exact name, folds any new name-form into `aliases`, and the delta prompt instructs the model to reuse the existing canonical name. `getCharacters` now orders by **plot importance** (role protagonist→antagonist→supporting→other, with VN synonyms, then event-count desc, then name) so main cast sits on top. NB: characters duplicated by the *old* code won't self-merge — a clean **Re-analyze** fixes existing data.

⚠️ **Spec-vs-reality deltas to honor when implementing (do NOT copy the SPEC samples verbatim):**
- **Model ID:** spec's `deltaExtractor` news up its own `GoogleGenerativeAI` on the dead `gemini-1.5-flash`. **Reuse `gemini.ts`** — route delta calls through the existing `callGemini` (multi-model free-Flash fallback + cooldowns) + `extractJson` (fence stripping), not a fresh client.
- **DB API shape:** spec calls object-arg helpers (`db.insertBookSeries({…})`, `db.insertSeries({name,…})`); our actual signatures are **positional** — `insertBookSeries(bookId, seriesId, volumeNumber)`, `insertSeries(name): string`. `seriesManager` wrappers must adapt.
- **Chunking:** spec's `chunkText` regex-splits raw text on `Chapter \d+`/`第…章`. We already store **per-chapter text** (`getChapters`) with titles — chunk from that array (group chapters up to ~8000 chars) instead of re-splitting a blob.
- **Import already auto-makes a series:** `import.ts` currently creates a standalone 1-vol series per book. Phase 5 must **intercept/route** that (assign-to-existing vs new) rather than adding a parallel path.
- **Quota reality:** the cost is ~**one Gemini call per chunk** on the first read — the `hasChanges:false` skip only avoids the local SQLite merge, **not** a Gemini call. So the single-book lever is **fewer/larger chunks**, and the KB delta's real saving is **cross-volume / re-run** (later volumes only extract their delta). Run sequentially, lean on `callGemini`'s 429 cooldowns (1500 req/day + ~15 RPM free caps), cache in SQLite forever. True OS-background processing needs the deferred foreground-service work; in Expo Go it's just an async job + progress UI.

### Phase 6 — AI images + polish (Wk 8)
- ⬜ `src/services/imageAI.ts` (Pollinations URLs, vi→en translate step)
- ⬜ Book covers + character art
- ⬜ Settings screen polish, theme/font, TTS voice picker

---

## Open questions / gotchas (carry forward)

### Live (unresolved)
- ~~**MP3 assets** need manual sourcing before `music.ts` is testable.~~ ✅ 22 loops bundled + compressed; MUSIC_SOURCES wired; `music.ts` + reader toggle done. Music **auto-plays from a book's tags**, so it pairs with Phase 4 auto-tagging. Not yet verified on-device (needs the CI/dev build).
- ~~**Background TTS on Android** needs a foreground service + lock-screen controls.~~ ✅ Built (2026-07-01) as a custom native module `modules/pocket-tts` (drives platform `TextToSpeech` in a `mediaPlayback` foreground service; `expo-speech` dropped from the speak path). **This forces a dev build** — Expo Go can't host the foreground service; run `npx expo prebuild` + `npx expo run:android` (or an EAS build) for anything audio. **Remaining on-device risk:** aggressive OEM battery optimizers (Xiaomi/Oppo/Samsung) can still kill a foreground service — may need a "disable battery optimization" prompt; verify per-device.
- **Gemini key** required in `.env` (`EXPO_PUBLIC_GEMINI_KEY`) before any AI feature works. Standing Phase 4 prerequisite — `.env.example` + `env.d.ts` typing exist; real `.env` must be added by the user. App soft-fails without it (`isGeminiConfigured()` → false, AI UI shows an "add key" hint).
- **Gemini model IDs drift** — verified July 2026: `gemini-1.5-flash`/1.0 are **shut down (404)**, Pro models are **paid-only**. Use free Flash: default `gemini-3.5-flash` with fallback to `gemini-2.5-flash`, `gemini-3.1-flash-lite` (`MODELS` in `gemini.ts`). Re-verify before assuming any pinned model still exists.

### Resolved
- ~~`Speech.isSpeakingAsync()` is async — spec's sync cast is wrong; fix in `tts.ts`.~~ ✅ Fixed — `tts.ts` `isSpeaking()` returns the promise directly (no cast).
- ~~FTS5 must be populated per-chapter on import (not auto).~~ ✅ Done — `import.ts` calls `indexChapter` per chapter → `INSERT INTO book_content_fts` (`db.ts`).
- ~~expo-file-system v19: use new API; fall back to `/legacy` import for raw-string reads if needed.~~ ✅ Settled — all parsers use the new `File`/`Directory`/`Paths` API; `/legacy` fallback never needed.

## How to run
```bash
npx expo start --android      # dev (Expo Go) — OK for everything EXCEPT audio
npx expo prebuild             # generate android/ (needed for the pocket-tts native module)
npx expo run:android          # local dev build — REQUIRED for read-aloud / background audio
```
> ⚠️ **Audio needs a dev build.** The `modules/pocket-tts` foreground-service module
> and `expo-audio` background playback are native — they don't exist in Expo Go.
> Use `expo run:android` (or an EAS build) to test read-aloud, music, and lock-screen controls.
