/**
 * Text-to-Speech via expo-speech (Android built-in engine).
 *
 * Language is hard-locked to vi-VN — never auto-detect (Gemini/Android will
 * mis-guess Hán-Việt content as Chinese; see docs/SPEC.md).
 *
 * Playback is **segment-based**: the caller passes the same paragraph array the
 * reader renders, and we speak them in order, reporting the active segment
 * index via `onSegment`. That lets the UI highlight the paragraph being read,
 * auto-scroll to it, and drive a seekable progress bar. A paragraph longer than
 * the Android `speak` length limit is internally sub-chunked on sentence
 * boundaries but still reported under its single segment index.
 *
 * Pause/resume: `Speech.pause()`/`Speech.resume()` are NOT available on Android,
 * so we simulate pause by stopping and remembering the queue cursor, then
 * re-speaking from the current chunk on resume (a sentence-group boundary).
 *
 * This module owns a single playback session (module-level state) and mirrors
 * lifecycle into `audioStore` so any UI can render controls.
 */
import * as Speech from "expo-speech";
import { Alert } from "react-native";

import { useAudioStore } from "@/src/store/audioStore";
import { splitIntoChunks } from "@/src/utils/text";

const LANGUAGE = "vi-VN";
const MAX_CHUNK = 3000;

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

/** One speakable unit: a sub-chunk of text tagged with its source segment. */
interface QueueItem {
  text: string;
  segment: number;
}

// --- Single playback session -------------------------------------------------

let queue: QueueItem[] = [];
let cursor = 0;
let reportedSegment = -1;
let sessionOptions: TTSOptions = {};
let sessionCallbacks: SpeakCallbacks = {};
/** Bumped on every stop/new-speak so stale onDone callbacks are ignored. */
let sessionId = 0;

/**
 * Begin reading `segments` aloud starting at `startIndex`. Any in-flight speech
 * is stopped. `segments` should be the paragraph array the reader renders so
 * reported indices line up with what's on screen.
 */
export function speak(
  segments: string[],
  startIndex = 0,
  options: TTSOptions = {},
  callbacks: SpeakCallbacks = {},
): void {
  stop();

  queue = [];
  for (let i = Math.max(0, startIndex); i < segments.length; i++) {
    for (const part of splitIntoChunks(segments[i] ?? "", MAX_CHUNK)) {
      if (part.trim()) queue.push({ text: part, segment: i });
    }
  }
  cursor = 0;
  reportedSegment = -1;
  sessionOptions = options;
  sessionCallbacks = callbacks;

  const audio = useAudioStore.getState();
  audio.setTtsTotalSegments(segments.length);

  if (queue.length === 0) {
    callbacks.onDone?.();
    return;
  }

  audio.setSpeaking(true);
  audio.setPaused(false);

  speakFromCursor();
}

function speakFromCursor(): void {
  const mySession = sessionId;
  const item = queue[cursor];
  if (item === undefined) return;

  if (item.segment !== reportedSegment) {
    reportedSegment = item.segment;
    useAudioStore.getState().setTtsSegment(item.segment);
    sessionCallbacks.onSegment?.(item.segment);
  }

  Speech.speak(item.text, {
    language: LANGUAGE,
    rate: sessionOptions.rate ?? 1.0,
    pitch: sessionOptions.pitch ?? 1.0,
    voice: sessionOptions.voice,
    onDone: () => {
      // Ignore if this session was superseded (stop/pause/new speak).
      if (mySession !== sessionId) return;
      cursor += 1;
      if (cursor < queue.length) {
        speakFromCursor();
      } else {
        finishSession();
      }
    },
    onError: (error) => {
      if (mySession !== sessionId) return;
      console.error("TTS error:", error);
      sessionCallbacks.onError?.(error);
      finishSession();
    },
  });
}

function finishSession(): void {
  const done = sessionCallbacks.onDone;
  resetState();
  const audio = useAudioStore.getState();
  audio.setSpeaking(false);
  audio.setPaused(false);
  audio.setTtsSegment(-1);
  done?.();
}

function resetState(): void {
  sessionId++;
  queue = [];
  cursor = 0;
  reportedSegment = -1;
  sessionOptions = {};
  sessionCallbacks = {};
}

/**
 * Pause playback. Because Android has no native pause, this stops speech and
 * keeps the cursor so `resume()` can re-speak from the current chunk.
 */
export function pause(): void {
  if (queue.length === 0) return;
  const audio = useAudioStore.getState();
  if (!audio.isSpeaking || audio.isPaused) return;

  sessionId++; // invalidate the in-flight chunk's onDone
  Speech.stop();
  audio.setPaused(true);
}

/** Resume after `pause()`, re-speaking from the start of the current chunk. */
export function resume(): void {
  const audio = useAudioStore.getState();
  if (!audio.isPaused || queue.length === 0) return;

  audio.setPaused(false);
  audio.setSpeaking(true);
  speakFromCursor();
}

/** Stop playback entirely and clear the session. */
export function stop(): void {
  const hadSession = queue.length > 0;
  Speech.stop();
  resetState();
  if (hadSession) {
    const audio = useAudioStore.getState();
    audio.setSpeaking(false);
    audio.setPaused(false);
    audio.setTtsSegment(-1);
  }
}

/** True while the engine is actively producing speech. */
export async function isSpeaking(): Promise<boolean> {
  return Speech.isSpeakingAsync();
}

// --- Voice availability ------------------------------------------------------

export async function getAvailableVoices(): Promise<Speech.Voice[]> {
  return Speech.getAvailableVoicesAsync();
}

/** Only the vi-VN voices the device has installed. */
export async function getVietnameseVoices(): Promise<Speech.Voice[]> {
  const voices = await getAvailableVoices();
  return voices.filter((v) => v.language?.startsWith("vi"));
}

export async function checkVietnameseTTS(): Promise<boolean> {
  const voices = await getAvailableVoices();
  return voices.some((v) => v.language?.startsWith("vi"));
}

/**
 * Call on first launch — if no Vietnamese voice is installed, guide the user to
 * download one (Android bundles no vi-VN voice by default on many devices).
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
