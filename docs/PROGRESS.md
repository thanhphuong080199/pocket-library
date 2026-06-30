# Pocket Library — Build Progress

Living tracker for the build. Update the status box + checklists as work lands. See `docs/SPEC.md` for the design and `CLAUDE.md` for principles/conventions.

**Legend:** ⬜ todo · 🟡 in progress · ✅ done · ⏸️ blocked/deferred

---

## Current status

- **Phase:** 0 — Scaffold & setup → **done**, moving into Phase 1 (Foundation)
- **Last updated:** 2026-06-30
- **App boots in Expo Go:** not yet verified (no screens wired)

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
- ⬜ `.env` + `EXPO_PUBLIC_GEMINI_KEY` typing (`expo-env.d.ts` / env.d.ts)
- ⬜ `src/` directory structure
- ⬜ Remove scaffold demo files (explore tab, hello-wave, etc.) once real screens exist
- ⬜ Android config for background audio (foreground service) — deferred to Phase 3

### Phase 1 — Foundation (DB, types, stores, constants)
- ⬜ `src/services/db.ts` — schema (books, bookmarks, characters, ai_cache, FTS5 + normalized col, series/KB tables), sync API, CRUD helpers
- ⬜ `src/utils/text.ts` — `normalizeVietnamese()`
- ⬜ `src/store/bookStore.ts` (zustand v5)
- ⬜ `src/store/audioStore.ts`
- ⬜ `src/store/settingsStore.ts` (persist via AsyncStorage: theme, font, voice, rate)
- ⬜ `src/constants/musicMap.ts` (tag → MP3) + `styleMap.ts` (genre → image style)
- ⬜ `initDB()` called on app launch (`app/_layout.tsx`)

### Phase 2 — Import + Reader (Wk 1–2)
- ⬜ `src/services/epub.ts` (epub.js via WebView)
- ⬜ `src/services/pdf.ts`, `docx.ts` (text extraction, new FS API)
- ⬜ Import flow (`expo-document-picker` → parse → saveBook → index FTS per chapter)
- ⬜ Library screen (`app/(tabs)/library.tsx`)
- ⬜ Reader screen (`app/(tabs)/reader.tsx`) — themes, font size, position save
- ⬜ Bookmarks
- ⬜ FTS5 search (diacritic-normalized)

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
