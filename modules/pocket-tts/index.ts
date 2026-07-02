/**
 * JS bindings for the `pocket-tts` native module (Android-only).
 *
 * This wraps the platform `TextToSpeech` engine inside a media-playback
 * foreground service, so read-aloud keeps running when the app is backgrounded
 * or the screen is locked, with lock-screen transport controls. The service —
 * not JS — chains the utterances, so background playback doesn't depend on the
 * JS thread staying awake.
 *
 * Consumed by `src/services/tts.ts`, which keeps the same public TTS API the app
 * already uses. Do not import this module elsewhere.
 */
import { requireNativeModule, type EventSubscription } from "expo-modules-core";

export type RemoteCommand = "play" | "pause" | "stop" | "next" | "prev";

export interface NativeVoice {
  identifier: string;
  name: string;
  language: string;
}

interface PocketTtsNative {
  /** True when the device has a usable TTS engine. */
  isAvailable: () => boolean;
  /**
   * Speak `chunks` in order. `segments[i]` is the reader paragraph index that
   * chunk `i` belongs to (many chunks can map to one paragraph), reported back
   * via the `onSegment` event so the UI can highlight/scroll. Starts speaking at
   * the first chunk whose segment is >= `startSegment`.
   */
  speak: (
    chunks: string[],
    segments: number[],
    startSegment: number,
    rate: number,
    pitch: number,
    voice: string | null,
  ) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  /** Update rate/pitch/voice on the live session (re-speaks the current chunk). */
  setOptions: (rate: number, pitch: number, voice: string | null) => void;
  /** Jump ±delta chunks (sentences); while paused only moves the cursor. */
  skip: (delta: number) => void;
  /** Update the lock-screen / notification metadata. */
  setNowPlaying: (title: string, chapter: string) => void;
  getVoices: () => Promise<NativeVoice[]>;
  addListener: (event: string, listener: (payload: unknown) => void) => EventSubscription;
}

const Native = requireNativeModule<PocketTtsNative>("PocketTts");

export function isAvailable(): boolean {
  return Native.isAvailable();
}

export function speak(
  chunks: string[],
  segments: number[],
  startSegment: number,
  rate: number,
  pitch: number,
  voice: string | null,
): void {
  Native.speak(chunks, segments, startSegment, rate, pitch, voice);
}

export function pause(): void {
  Native.pause();
}

export function resume(): void {
  Native.resume();
}

export function stop(): void {
  Native.stop();
}

export function setOptions(rate: number, pitch: number, voice: string | null): void {
  Native.setOptions(rate, pitch, voice);
}

export function skip(delta: number): void {
  Native.skip(delta);
}

export function setNowPlaying(title: string, chapter: string): void {
  Native.setNowPlaying(title, chapter);
}

export function getVoices(): Promise<NativeVoice[]> {
  return Native.getVoices();
}

export function onSegment(cb: (index: number) => void): EventSubscription {
  return Native.addListener("onSegment", (p) => cb((p as { index: number }).index));
}

export function onDone(cb: () => void): EventSubscription {
  return Native.addListener("onDone", () => cb());
}

export function onError(cb: (message: string) => void): EventSubscription {
  return Native.addListener("onError", (p) => cb((p as { message: string }).message));
}

export function onRemoteCommand(cb: (command: RemoteCommand) => void): EventSubscription {
  return Native.addListener("onRemoteCommand", (p) =>
    cb((p as { command: RemoteCommand }).command),
  );
}
