/**
 * Text-to-Speech, backed by the custom native `pocket-tts` foreground service.
 *
 * Language is hard-locked to vi-VN by the native engine — never auto-detect
 * (Gemini/Android will mis-guess Hán-Việt content as Chinese; see docs/SPEC.md).
 *
 * Playback is **segment-based**: the caller passes the same paragraph array the
 * reader renders; this module sanitizes + sub-chunks each paragraph on sentence
 * boundaries (for natural prosody) and hands the flat chunk list to the native
 * service, which speaks + chains them **natively** inside a media foreground
 * service. That's what lets read-aloud keep going when the app is backgrounded or
 * the screen is locked, with lock-screen transport controls — the JS thread is no
 * longer in the per-utterance loop.
 *
 * The public API is unchanged from the old expo-speech implementation so the
 * reader / playback session don't care which engine is underneath. Pause is real
 * on the native side (stop + resume-from-cursor); the module still mirrors
 * lifecycle into `audioStore` so any UI can render controls.
 */
import { Alert } from "react-native";

import * as PocketTts from "@/modules/pocket-tts";
import { useAudioStore } from "@/src/store/audioStore";
import { sanitizeForSpeech, splitIntoChunks } from "@/src/utils/text";

/**
 * Target utterance size. Deliberately small (≈ 1–3 sentences): the engine resets
 * sentence intonation per utterance and inserts a natural pause between them, so
 * sentence-sized pieces sound far less monotone than one long run-on utterance.
 * `splitIntoChunks` never cuts mid-sentence, so a longer sentence still goes whole.
 */
const MAX_CHUNK = 280;

export interface TTSOptions {
  rate?: number; // 0.1 – 2.0, default 1.0
  pitch?: number; // 0.5 – 2.0, default 1.0
  voice?: string; // voice identifier from getAvailableVoices()
}

export interface SpeakCallbacks {
  /** Fired when a new segment (paragraph) begins, 0-based index into `segments`. */
  onSegment?: (index: number) => void;
  /** Fired once the whole text finishes naturally (not on stop/pause). */
  onDone?: () => void;
  onError?: (error: unknown) => void;
}

export interface Voice {
  identifier: string;
  name: string;
  language: string;
}

/** Handlers the playback session registers so lock-screen next/prev can change chapter. */
export interface RemoteChapterHandler {
  next: () => void;
  prev: () => void;
}

// --- Single playback session -------------------------------------------------

let sessionCallbacks: SpeakCallbacks = {};
let remoteChapter: RemoteChapterHandler | null = null;

/** Register lock-screen chapter navigation (called once by the playback session). */
export function setRemoteChapterHandler(handler: RemoteChapterHandler): void {
  remoteChapter = handler;
}

// Wire native events to the store + the active session's callbacks. Set up once.
PocketTts.onSegment((index) => {
  useAudioStore.getState().setTtsSegment(index);
  sessionCallbacks.onSegment?.(index);
});

PocketTts.onDone(() => {
  const done = sessionCallbacks.onDone;
  setIdle();
  done?.();
});

PocketTts.onError((message) => {
  const onError = sessionCallbacks.onError;
  setIdle();
  onError?.(new Error(message));
});

PocketTts.onRemoteCommand((command) => {
  const audio = useAudioStore.getState();
  switch (command) {
    case "play":
      audio.setPaused(false);
      audio.setSpeaking(true);
      break;
    case "pause":
      audio.setPaused(true);
      break;
    case "stop":
      setIdle();
      break;
    case "next":
      remoteChapter?.next();
      break;
    case "prev":
      remoteChapter?.prev();
      break;
  }
});

function setIdle(): void {
  const audio = useAudioStore.getState();
  audio.setSpeaking(false);
  audio.setPaused(false);
  audio.setTtsSegment(-1);
}

/**
 * Begin reading `segments` aloud starting at `startIndex`. Any in-flight speech
 * is replaced. `segments` should be the paragraph array the reader renders so
 * reported indices line up with what's on screen.
 */
export function speak(
  segments: string[],
  startIndex = 0,
  options: TTSOptions = {},
  callbacks: SpeakCallbacks = {},
): void {
  // Flatten paragraphs → sentence-sized chunks, tracking each chunk's paragraph.
  const chunks: string[] = [];
  const segmentIndices: number[] = [];
  for (let i = 0; i < segments.length; i++) {
    const spoken = sanitizeForSpeech(segments[i] ?? "");
    for (const part of splitIntoChunks(spoken, MAX_CHUNK)) {
      if (part.trim()) {
        chunks.push(part);
        segmentIndices.push(i);
      }
    }
  }

  sessionCallbacks = callbacks;
  const audio = useAudioStore.getState();
  audio.setTtsTotalSegments(segments.length);

  if (chunks.length === 0) {
    setIdle();
    callbacks.onDone?.();
    return;
  }

  audio.setSpeaking(true);
  audio.setPaused(false);

  // Push now-playing metadata (set by the playback session) to the lock screen.
  PocketTts.setNowPlaying(audio.bookTitle, audio.chapterTitle);
  PocketTts.speak(
    chunks,
    segmentIndices,
    Math.max(0, startIndex),
    options.rate ?? 1.0,
    options.pitch ?? 1.0,
    options.voice ?? null,
  );
}

/** Pause playback (native stops + remembers the cursor; `resume` re-speaks from it). */
export function pause(): void {
  const audio = useAudioStore.getState();
  if (!audio.isSpeaking || audio.isPaused) return;
  PocketTts.pause();
  audio.setPaused(true);
}

/** Resume after `pause()`. */
export function resume(): void {
  const audio = useAudioStore.getState();
  if (!audio.isPaused) return;
  PocketTts.resume();
  audio.setPaused(false);
  audio.setSpeaking(true);
}

/** Stop playback entirely and clear the session. */
export function stop(): void {
  sessionCallbacks = {};
  PocketTts.stop();
  setIdle();
}

/** True while the engine is actively producing speech (not paused/idle). */
export async function isSpeaking(): Promise<boolean> {
  const audio = useAudioStore.getState();
  return audio.isSpeaking && !audio.isPaused;
}

// --- Voice availability ------------------------------------------------------

export async function getAvailableVoices(): Promise<Voice[]> {
  return PocketTts.getVoices();
}

/** Only the vi-VN voices the device has installed. */
export async function getVietnameseVoices(): Promise<Voice[]> {
  const voices = await getAvailableVoices();
  return voices.filter((v) => v.language?.startsWith("vi"));
}

export async function checkVietnameseTTS(): Promise<boolean> {
  const voices = await getVietnameseVoices();
  return voices.length > 0;
}

/**
 * Call when starting read-aloud — if no Vietnamese voice is installed, guide the
 * user to download one (Android bundles no vi-VN voice by default on many devices).
 */
export async function ensureVietnameseTTS(): Promise<void> {
  const available = await checkVietnameseTTS();
  if (!available) {
    Alert.alert(
      "Thiếu giọng đọc tiếng Việt",
      "Vào Cài đặt → Trợ năng → Chuyển văn bản thành giọng nói → Tải thêm giọng tiếng Việt.",
      [{ text: "Đã hiểu" }],
    );
  }
}
