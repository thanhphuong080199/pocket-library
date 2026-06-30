/**
 * Transient audio state: TTS playback + background music.
 * The actual engines live in services/tts.ts and services/music.ts; this store
 * holds only what the UI needs to render controls.
 */
import { create } from "zustand";

interface AudioState {
  // TTS
  isSpeaking: boolean;
  isPaused: boolean;
  /** chapter index currently being read aloud */
  ttsChapter: number;

  // Music
  isMusicPlaying: boolean;
  currentTrack: string | null;

  setSpeaking: (isSpeaking: boolean) => void;
  setPaused: (isPaused: boolean) => void;
  setTtsChapter: (ttsChapter: number) => void;
  setMusicPlaying: (isMusicPlaying: boolean) => void;
  setCurrentTrack: (currentTrack: string | null) => void;
  reset: () => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  isSpeaking: false,
  isPaused: false,
  ttsChapter: 0,
  isMusicPlaying: false,
  currentTrack: null,

  setSpeaking: (isSpeaking) => set({ isSpeaking }),
  setPaused: (isPaused) => set({ isPaused }),
  setTtsChapter: (ttsChapter) => set({ ttsChapter }),
  setMusicPlaying: (isMusicPlaying) => set({ isMusicPlaying }),
  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  reset: () =>
    set({ isSpeaking: false, isPaused: false, isMusicPlaying: false, currentTrack: null }),
}));
