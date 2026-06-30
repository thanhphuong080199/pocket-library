# CLAUDE.md — BookApp (Pocket Library)

Personal Android e-book reader with free AI features. React Native + Expo, **Android only**, **personal use**, **no backend** — everything stored locally on device.

> Full design doc + reference sample code: **`docs/SPEC.md`** (gemini.ts, imageAI.ts, music.ts, tts.ts, db.ts, bookStore.ts, useBookAI.ts). Use it as the starting reference when implementing each service.

> Status: **scaffolded (Expo SDK 54), foundation built.** Phase 0 done; Phase 1 (db + stores + utils + constants) done and typechecking clean. Next: Phase 2 (import + reader). Live progress tracker: **`docs/PROGRESS.md`** — update it as work lands.

> ⚠️ Actual versions deviate from the "pinned intentions" below — those were SDK 51 aspirations. See `docs/PROGRESS.md` "Key environment decisions" for the source of truth. Summary: **SDK 54** (expo-router ~6, RN 0.81, React 19.1, zustand v5); **AsyncStorage instead of MMKV** (MMKV is native → not in Expo Go); **expo-audio instead of expo-av** (av removed in SDK 54); **expo-file-system v19** new API. Path alias `@/*` → repo root, so services import as `@/src/services/...`.

## Core principles
- **100% free stack.** Every dependency and AI service must be free. Gemini Flash (1500 req/day free), Pollinations.ai (no key), Android built-in TTS, bundled royalty-free MP3s.
- **No server, no cloud sync.** All state in local SQLite + AsyncStorage. The device is the source of truth.
- **Cache AI forever.** Always check `ai_cache` (SQLite) before calling Gemini. One book = one analysis = cached permanently. Burning Gemini quota on a re-analysis is a bug.
- **Keep it light.** Deliberately avoiding Redux, Axios, NativeWind, React Navigation, react-native-pdf, react-native-track-player. Don't add them — see "Intentionally NOT used" below. Push back if a task seems to require one.

## Tech stack (pinned intentions)
- `expo` ~51 (managed workflow) + `expo-router` ~3.5 (file-based routing — **no React Navigation**)
- TypeScript throughout
- UI: RN core components only (`View`/`Text`/`FlatList`/`Pressable`) + `StyleSheet.create()`. `react-native-reanimated` ~3.10 for animation only where needed. **No CSS-in-JS / no UI kit.**
- State: `zustand` (no Redux). Persisted settings via `@react-native-async-storage/async-storage` (was MMKV — see note above).
- Storage: `expo-sqlite` (books, bookmarks, characters, ai_cache, FTS5 search) — synchronous API
- Parsing: `react-native-webview` (epub.js for EPUB), `expo-file-system` v19 new API (PDF/DOCX text extraction), `expo-document-picker` (import)
- Audio: `expo-speech` (TTS, Vietnamese `vi-VN` default), `expo-audio` (background music — was expo-av)
- AI: `@google/generative-ai` ^0.15 (Gemini `gemini-1.5-flash`), Pollinations.ai via plain `fetch` URL (no package)
- Networking: native `fetch` (**no Axios**)

## Intentionally NOT used (do not add)
Redux/RTK · Axios · NativeWind/styled-components · React Navigation · react-native-pdf (needs Dev Client) · react-native-track-player (heavy native build).

## Project structure (target)
```
app/                         # Expo Router screens
  (tabs)/library.tsx | reader.tsx | settings.tsx
  character/[id].tsx
  _layout.tsx
src/
  components/  Reader/ AudioPlayer/ AIPanel/
  services/    epub.ts pdf.ts docx.ts tts.ts music.ts gemini.ts imageAI.ts db.ts
  store/       bookStore.ts audioStore.ts settingsStore.ts   # zustand
  constants/   musicMap.ts styleMap.ts                       # tag→MP3, genre→image style
  hooks/       useBookAI.ts                                   # tags → music + cache flow
assets/music/   # 20-30 bundled royalty-free MP3 loops (60-180s)
```

## Conventions
- Services are plain functions, not classes. State lives in zustand stores; services are stateless except module-level singletons (e.g. the single `Audio.Sound` instance in `music.ts`, `db` handle in `db.ts`).
- DB access is **synchronous** (`db.execSync`/`runSync`/`getAllSync`/`getFirstSync`) — `expo-sqlite` new API. JSON-encode arrays/objects into TEXT columns (tags, skills, relationships, lastPosition).
- Gemini prompts must demand **raw JSON, no markdown fences**, then `JSON.parse`. (Consider stripping ```` ```json ```` fences defensively — the model sometimes wraps output despite instructions.)
- Pollinations images are just URLs: `https://image.pollinations.ai/prompt/<encoded>?width=400&height=600&nologo=true`. Genre → style prompt via `STYLE_MAP`, fallback to generic "digital art".
- TTS: split text into ≤3000-char chunks on sentence boundaries, chain via `onDone`. Background music plays at low volume (~0.2) under TTS.
- IDs: `book_<timestamp>`, `bm_<timestamp>`, etc. Timestamps are `Date.now()` integers.

## Environment
- `.env` at root: `EXPO_PUBLIC_GEMINI_KEY=...` (free key from aistudio.google.com). `EXPO_PUBLIC_` prefix is required for Expo to expose it to the client.

## Commands
```bash
npx expo start --android                              # dev
npx expo run:android                                  # local build, no EAS
npx eas build --platform android --profile preview    # production APK
```

## Build order (8 weeks)
1. Wk 1-2: Import + Reader (EPUB first, then PDF/DOCX)
2. Wk 3-4: TTS + background music
3. Wk 5-6: Gemini text features (tags, summary, characters, word explainer, power system)
4. Wk 7-8: AI images (covers, character art) + polish

## Open items / gotchas to resolve during build
- `Speech.isSpeakingAsync()` is async — the spec's sync `isSpeaking()` cast is wrong; fix when implementing `tts.ts`.
- FTS5 (`book_content_fts`) must be populated on import (insert per chapter) for search to work — not auto-filled.
- Royalty-free MP3s (Pixabay/FMA/Incompetech) need to be sourced and bundled before `music.ts` works; `MUSIC_SOURCES` requires literal `require()` per file.
- Background TTS needs a foreground service + lock-screen controls on Android — `expo-speech` alone may not keep playing when backgrounded; verify and add config if needed.
