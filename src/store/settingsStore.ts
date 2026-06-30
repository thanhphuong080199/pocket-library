/**
 * Persisted user settings (theme, font, TTS voice/rate, music toggle).
 *
 * Persistence uses AsyncStorage rather than MMKV: MMKV is a native module and
 * is NOT available in Expo Go (see docs/PROGRESS.md). AsyncStorage works in
 * Expo Go and is plenty for a handful of preference keys.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemeName = "white" | "sepia" | "dark" | "black";

export interface ThemeColors {
  background: string;
  text: string;
  /** subdued text / borders */
  muted: string;
}

export const THEMES: Record<ThemeName, ThemeColors> = {
  white: { background: "#ffffff", text: "#1a1a1a", muted: "#888888" },
  sepia: { background: "#f4ecd8", text: "#5b4636", muted: "#a08b6f" },
  dark: { background: "#1e1e1e", text: "#dcdcdc", muted: "#777777" },
  black: { background: "#000000", text: "#cccccc", muted: "#666666" },
};

export const FONT_FAMILIES = ["System", "serif", "monospace"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

interface SettingsState {
  theme: ThemeName;
  fontSize: number; // px
  fontFamily: FontFamily;
  lineHeight: number; // multiplier

  // TTS
  ttsVoice?: string; // voice identifier from getAvailableVoicesAsync
  ttsRate: number; // 0.5 – 2.0
  ttsPitch: number; // 0.5 – 2.0

  // Music
  musicEnabled: boolean;
  musicVolume: number; // 0 – 1

  setTheme: (theme: ThemeName) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: FontFamily) => void;
  setLineHeight: (lh: number) => void;
  setTtsVoice: (voice?: string) => void;
  setTtsRate: (rate: number) => void;
  setTtsPitch: (pitch: number) => void;
  setMusicEnabled: (enabled: boolean) => void;
  setMusicVolume: (volume: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "sepia",
      fontSize: 18,
      fontFamily: "serif",
      lineHeight: 1.6,

      ttsRate: 1.0,
      ttsPitch: 1.0,

      musicEnabled: true,
      musicVolume: 0.2,

      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize: clamp(fontSize, 10, 40) }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setLineHeight: (lineHeight) => set({ lineHeight: clamp(lineHeight, 1, 3) }),
      setTtsVoice: (ttsVoice) => set({ ttsVoice }),
      setTtsRate: (ttsRate) => set({ ttsRate: clamp(ttsRate, 0.5, 2) }),
      setTtsPitch: (ttsPitch) => set({ ttsPitch: clamp(ttsPitch, 0.5, 2) }),
      setMusicEnabled: (musicEnabled) => set({ musicEnabled }),
      setMusicVolume: (musicVolume) => set({ musicVolume: clamp(musicVolume, 0, 1) }),
    }),
    {
      name: "pocket-library-settings",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
