# Pocket Library

Personal Android e-book reader with free, built-in AI. Import your EPUB/PDF/DOCX books and get AI summaries, character tracking, auto-generated cover art, word explanations, and mood-matched background music — all running on-device with no backend and no subscriptions.

Built with **React Native + Expo (SDK 54)** and **Google Gemini Flash**. Android only, personal use.

## Features

- 📚 **Import any book** — EPUB, PDF, and DOCX via the system document picker.
- 📖 **Distraction-free reader** — paginated reading with adjustable typography and reading-position memory.
- 🔊 **Text-to-speech** — Android built-in TTS with Vietnamese (`vi-VN`) support and low-volume background music underneath narration.
- 🎵 **Mood music** — bundled royalty-free loops chosen automatically from the book's AI-detected tags.
- 🤖 **AI insights (Gemini Flash)** — one-tap summaries, tag detection, character extraction, in-context word explanations, and power/magic-system breakdowns.
- 🧑‍🎨 **Auto-generated art** — book covers and character portraits via Pollinations.ai (no API key required).
- 🌐 **Vietnamese localization** throughout the UI.
- 💾 **Everything local** — SQLite + AsyncStorage on device. No account, no cloud, no sync.

## Why it's 100% free

Every dependency and AI service is free-tier:

- **Gemini 1.5 Flash** — 1,500 requests/day free. AI results are cached permanently in SQLite (`ai_cache`), so each book is analyzed once.
- **Pollinations.ai** — image generation via plain URL, no key.
- **Android built-in TTS** — no cloud speech service.
- **Bundled royalty-free MP3s** — sourced from Pixabay / Free Music Archive / Incompetech.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | Expo SDK 54 (managed), React Native 0.81, React 19.1 |
| Routing | `expo-router` (file-based) |
| Language | TypeScript |
| State | `zustand` v5 + `@react-native-async-storage/async-storage` |
| Storage | `expo-sqlite` (books, bookmarks, characters, `ai_cache`, FTS5 search) |
| Parsing | `react-native-webview` (epub.js), `expo-file-system` v19 (PDF/DOCX) |
| Audio | `expo-speech` (TTS), `expo-audio` (music) |
| AI | `@google/generative-ai` (Gemini Flash), Pollinations.ai via `fetch` |

Deliberately lightweight — no Redux, Axios, NativeWind, React Navigation, react-native-pdf, or react-native-track-player.

## Getting started

Requires an Android device/emulator and a free Gemini API key from [aistudio.google.com](https://aistudio.google.com).

```bash
# 1. Install dependencies
npm install

# 2. Add your Gemini key to a .env file at the repo root
echo "EXPO_PUBLIC_GEMINI_KEY=your_key_here" > .env

# 3. Run on Android
npx expo start --android
```

### Other commands

```bash
npx expo run:android                                # local native build (no EAS)
npx eas build --platform android --profile preview  # production APK
```

## Project structure

```
app/                 # Expo Router screens
  (tabs)/            #   library · reader · settings
  character/[id].tsx #   character detail
src/
  components/        # Reader/ AudioPlayer/ AIPanel/
  services/          # epub · pdf · docx · tts · music · gemini · imageAI · db
  store/             # zustand: bookStore · audioStore · settingsStore
  constants/         # musicMap (tag→MP3), styleMap (genre→image style)
  hooks/             # useBookAI (tags → music + cache flow)
assets/music/        # bundled royalty-free MP3 loops
docs/                # SPEC.md · PROGRESS.md
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full design doc and [`docs/PROGRESS.md`](docs/PROGRESS.md) for live build status.

## Status

Foundation built (Expo SDK 54). Import + reader, TTS + music, and Gemini AI features under active development. This is a personal project — no server, no telemetry, device is the source of truth.
