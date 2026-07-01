/**
 * App-wide floating mini-player. Visible on every screen whenever read-aloud or
 * background music is active, so the user can control playback (and music volume)
 * without being on the reader — a companion to the actual background service
 * (`modules/pocket-tts`) and the lock-screen controls.
 */
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";

import * as music from "@/src/services/music";
import * as playback from "@/src/services/playbackSession";
import * as tts from "@/src/services/tts";
import { useAudioStore } from "@/src/store/audioStore";
import { useBookStore } from "@/src/store/bookStore";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

export function AudioPlayerBar() {
  const colors = THEMES[useSettingsStore((s) => s.theme)];
  const isSpeaking = useAudioStore((s) => s.isSpeaking);
  const isPaused = useAudioStore((s) => s.isPaused);
  const isMusicPlaying = useAudioStore((s) => s.isMusicPlaying);
  const bookTitle = useAudioStore((s) => s.bookTitle);
  const chapterTitle = useAudioStore((s) => s.chapterTitle);
  const chapterIndex = useAudioStore((s) => s.chapterIndex);
  const totalChapters = useAudioStore((s) => s.totalChapters);
  const currentTrack = useAudioStore((s) => s.currentTrack);

  const ttsActive = isSpeaking || isPaused;
  const musicAvailable = music.isMusicAvailable();

  if (!ttsActive && !isMusicPlaying) return null;

  const toggleMusic = () => {
    if (useAudioStore.getState().isMusicPlaying) {
      music.stopMusic();
    } else {
      void music.playForTags(useBookStore.getState().currentBook?.tags ?? []);
    }
  };

  const title = ttsActive ? bookTitle || "Đang đọc" : "Nhạc nền";
  const subtitle = ttsActive
    ? `${chapterTitle}${totalChapters ? ` · ${chapterIndex + 1}/${totalChapters}` : ""}`
    : currentTrack ?? "";

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, borderColor: colors.muted }]}>
      <View style={styles.textCol}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>

      <View style={styles.controls}>
        {ttsActive && (
          <>
            <Pressable onPress={() => playback.prevChapter()} hitSlop={8}>
              <Ionicons name="play-skip-back" size={22} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => playback.togglePlayback()} hitSlop={8}>
              <Ionicons
                name={isSpeaking && !isPaused ? "pause-circle" : "play-circle"}
                size={30}
                color={colors.text}
              />
            </Pressable>
            <Pressable onPress={() => playback.nextChapter()} hitSlop={8}>
              <Ionicons name="play-skip-forward" size={22} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => tts.stop()} hitSlop={8}>
              <Ionicons name="stop-circle" size={24} color={colors.text} />
            </Pressable>
          </>
        )}
        {musicAvailable && (
          <Pressable onPress={toggleMusic} hitSlop={8}>
            <Ionicons
              name={isMusicPlaying ? "musical-notes" : "musical-notes-outline"}
              size={22}
              color={isMusicPlaying ? "#e67e22" : colors.text}
            />
          </Pressable>
        )}
      </View>

      {isMusicPlaying && <VolumeSlider colors={colors} />}
    </View>
  );
}

/** Compact music-volume slider (touch-responder track, no slider dependency). */
function VolumeSlider({ colors }: { colors: { text: string; muted: string } }) {
  const [w, setWidth] = useState(0);
  const [vol, setVol] = useState(() => music.getMusicVolume());

  const fracFromX = (x: number) => Math.max(0, Math.min(1, x / (w || 1)));
  const apply = (f: number) => {
    setVol(f);
    music.setMusicVolume(f);
  };

  return (
    <View style={styles.volumeRow}>
      <Ionicons name="volume-low" size={16} color={colors.muted} />
      <View
        style={styles.volTouch}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e: GestureResponderEvent) => apply(fracFromX(e.nativeEvent.locationX))}
        onResponderMove={(e: GestureResponderEvent) => apply(fracFromX(e.nativeEvent.locationX))}>
        <View style={[styles.volTrack, { backgroundColor: colors.muted }]}>
          <View style={[styles.volFill, { backgroundColor: colors.text, width: `${vol * 100}%` }]} />
        </View>
      </View>
      <Ionicons name="volume-high" size={16} color={colors.muted} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 70,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  textCol: { gap: 2 },
  title: { fontSize: 14, fontWeight: "700" },
  subtitle: { fontSize: 12 },
  controls: { flexDirection: "row", alignItems: "center", gap: 18 },
  volumeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  volTouch: { flex: 1, height: 24, justifyContent: "center" },
  volTrack: { height: 4, borderRadius: 2, overflow: "hidden", opacity: 0.5 },
  volFill: { height: 4, borderRadius: 2 },
});
