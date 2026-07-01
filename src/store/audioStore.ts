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
  /** segment (paragraph) index currently being read; -1 when idle */
  ttsSegment: number;
  /** total segments (paragraphs) in the chapter being read */
  ttsTotalSegments: number;

  // Music
  isMusicPlaying: boolean;
  currentTrack: string | null;

  setSpeaking: (isSpeaking: boolean) => void;
  setPaused: (isPaused: boolean) => void;
  setTtsChapter: (ttsChapter: number) => void;
  setTtsSegment: (ttsSegment: number) => void;
  setTtsTotalSegments: (ttsTotalSegments: number) => void;
  setMusicPlaying: (isMusicPlaying: boolean) => void;
  setCurrentTrack: (currentTrack: string | null) => void;
  reset: () => void;
}

export const useAudioStore = create<AudioState>((set) => ({
  isSpeaking: false,
  isPaused: false,
  ttsChapter: 0,
  ttsSegment: -1,
  ttsTotalSegments: 0,
  isMusicPlaying: false,
  currentTrack: null,

  setSpeaking: (isSpeaking) => set({ isSpeaking }),
  setPaused: (isPaused) => set({ isPaused }),
  setTtsChapter: (ttsChapter) => set({ ttsChapter }),
  setTtsSegment: (ttsSegment) => set({ ttsSegment }),
  setTtsTotalSegments: (ttsTotalSegments) => set({ ttsTotalSegments }),
  setMusicPlaying: (isMusicPlaying) => set({ isMusicPlaying }),
  setCurrentTrack: (currentTrack) => set({ currentTrack }),
  reset: () =>
    set({
      isSpeaking: false,
      isPaused: false,
      ttsSegment: -1,
      ttsTotalSegments: 0,
      isMusicPlaying: false,
      currentTrack: null,
    }),
}));
