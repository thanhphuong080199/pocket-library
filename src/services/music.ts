/**
 * Background music engine (expo-audio, SDK 54 — NOT expo-av).
 *
 * One looping track plays quietly (~0.2) under TTS. Track choice comes from a
 * book's AI tags (see gemini.ts `generateTags` → same key space as MUSIC_MAP),
 * so "cultivation, action" → an erhu/battle loop with no extra mapping.
 *
 * Design (see CLAUDE.md):
 * - **Single module-level player.** Stateless service around one AudioPlayer
 *   singleton; the UI reads playback state from `audioStore`.
 * - **Metro needs literal require()s** → tracks resolve via MUSIC_SOURCES, not
 *   dynamic paths. If a mapped file has no source entry, it's skipped.
 * - **Non-critical.** Every entry point is guarded; audio failures warn and
 *   no-op rather than crash the reader.
 * - **Mixes under TTS.** Audio mode is `mixWithOthers` so the platform TTS
 *   engine plays on top while this loop stays low in the mix.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

import { MUSIC_MAP, MUSIC_SOURCES } from "@/src/constants/musicMap";
import { useAudioStore } from "@/src/store/audioStore";

/** Low enough to sit under narration/reading. */
const MUSIC_VOLUME = 0.2;

/** Played when tags don't map to anything (but assets exist) — gentle, neutral. */
const DEFAULT_TRACKS = ["lofi_chill.mp3", "soft_piano.mp3"];

let player: AudioPlayer | null = null;
/** Filename of the loop currently loaded, so re-tagging the same mood is a no-op. */
let currentFile: string | null = null;
/** Last non-muted volume, so pause/duck can restore it. */
let volume = MUSIC_VOLUME;
let audioModeReady = false;

/** True once at least one MP3 is bundled (MUSIC_SOURCES populated). */
export function isMusicAvailable(): boolean {
  return Object.keys(MUSIC_SOURCES).length > 0;
}

/** Configure the shared audio session once: play in silence, mix under TTS. */
async function ensureAudioMode(): Promise<void> {
  if (audioModeReady) return;
  audioModeReady = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "mixWithOthers",
      shouldPlayInBackground: true,
    });
  } catch (e) {
    audioModeReady = false; // let a later call retry
    console.warn("[music] setAudioModeAsync failed", e);
  }
}

/**
 * Choose a bundled track for a set of tags. Collects candidates from every
 * matching MUSIC_MAP entry, keeps only those with a real asset, and picks one
 * at random for variety. Falls back to a neutral default, else null.
 */
function pickTrack(tags: string[]): string | null {
  const candidates = new Set<string>();
  for (const tag of tags) {
    for (const file of MUSIC_MAP[tag] ?? []) {
      if (MUSIC_SOURCES[file] != null) candidates.add(file);
    }
  }
  if (candidates.size === 0) {
    for (const file of DEFAULT_TRACKS) {
      if (MUSIC_SOURCES[file] != null) candidates.add(file);
    }
  }
  if (candidates.size === 0) return null;
  const pool = [...candidates];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Load + loop a specific file at the current volume, replacing any prior track. */
function loadAndPlay(file: string): void {
  const source = MUSIC_SOURCES[file];
  if (source == null) return;

  // Tear down the previous loop so we never leak a native player.
  if (player) {
    try {
      player.remove();
    } catch {
      /* already gone */
    }
    player = null;
  }

  player = createAudioPlayer(source);
  player.loop = true;
  player.volume = volume;
  player.play();
  currentFile = file;

  const { setMusicPlaying, setCurrentTrack } = useAudioStore.getState();
  setMusicPlaying(true);
  setCurrentTrack(file);
}

/**
 * Play a background loop chosen from a book's tags. If the chosen track is
 * already playing, does nothing (no restart on re-open / re-tag).
 */
export async function playForTags(tags: string[]): Promise<void> {
  if (!isMusicAvailable()) return;
  const file = pickTrack(tags);
  if (!file) return;
  if (file === currentFile && player?.playing) return;

  await ensureAudioMode();
  try {
    loadAndPlay(file);
  } catch (e) {
    console.warn("[music] failed to play", file, e);
  }
}

/** Pause the loop without unloading it (keeps position for resume). */
export function pauseMusic(): void {
  try {
    player?.pause();
  } catch (e) {
    console.warn("[music] pause failed", e);
  }
  useAudioStore.getState().setMusicPlaying(false);
}

/** Resume a paused loop. No-op if nothing is loaded. */
export function resumeMusic(): void {
  if (!player) return;
  try {
    player.play();
    useAudioStore.getState().setMusicPlaying(true);
  } catch (e) {
    console.warn("[music] resume failed", e);
  }
}

/** Stop and fully unload the current loop. */
export function stopMusic(): void {
  if (player) {
    try {
      player.pause();
      player.remove();
    } catch {
      /* already gone */
    }
    player = null;
  }
  currentFile = null;
  const { setMusicPlaying, setCurrentTrack } = useAudioStore.getState();
  setMusicPlaying(false);
  setCurrentTrack(null);
}

/** Set music volume (0–1). Persisted for the session so resume restores it. */
export function setMusicVolume(next: number): void {
  volume = Math.max(0, Math.min(1, next));
  if (player) {
    try {
      player.volume = volume;
    } catch (e) {
      console.warn("[music] volume set failed", e);
    }
  }
}

export function getMusicVolume(): number {
  return volume;
}
