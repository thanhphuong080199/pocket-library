/**
 * App-wide floating mini-player. Visible on every screen whenever read-aloud or
 * background music is active, so the user can control playback (and music volume)
 * without being on the reader — a companion to the actual background service
 * (`modules/pocket-tts`) and the lock-screen controls.
 *
 * Collapsible: the chevron shrinks it to a small pill (mirroring KbProgressBanner),
 * anchored bottom-left so it can coexist with the analysis pill (bottom-right).
 * The expanded card also hosts the read-aloud seek bar and quick voice settings
 * (speed / pitch / vi-VN voice) that apply live to the running session.
 */
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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
  const ttsSegment = useAudioStore((s) => s.ttsSegment);
  const ttsTotalSegments = useAudioStore((s) => s.ttsTotalSegments);
  const minimized = useAudioStore((s) => s.playerMinimized);
  const setMinimized = (v: boolean) => useAudioStore.getState().setPlayerMinimized(v);

  const [showSettings, setShowSettings] = useState(false);

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

  // Collapsed: a small pill with play/pause + live paragraph progress.
  if (minimized) {
    return (
      <Pressable
        onPress={() => setMinimized(false)}
        style={[styles.pill, { backgroundColor: colors.background, borderColor: colors.muted }]}>
        <Ionicons name={ttsActive ? "headset" : "musical-notes"} size={16} color={colors.text} />
        {ttsActive && ttsTotalSegments > 0 && (
          <Text style={[styles.pillText, { color: colors.text }]}>
            ¶ {Math.max(0, ttsSegment) + 1}/{ttsTotalSegments}
          </Text>
        )}
        {ttsActive && (
          <Pressable onPress={() => playback.togglePlayback()} hitSlop={8}>
            <Ionicons
              name={isSpeaking && !isPaused ? "pause-circle" : "play-circle"}
              size={22}
              color={colors.text}
            />
          </Pressable>
        )}
      </Pressable>
    );
  }

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, borderColor: colors.muted }]}>
      <View style={styles.headerRow}>
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
        <Pressable onPress={() => setMinimized(true)} hitSlop={8}>
          <Ionicons name="chevron-down" size={20} color={colors.muted} />
        </Pressable>
      </View>

      {ttsActive && ttsTotalSegments > 0 && (
        <TtsProgress
          current={ttsSegment}
          total={ttsTotalSegments}
          colors={colors}
          onSeek={(para) => {
            const a = useAudioStore.getState();
            const clamped = Math.max(0, Math.min(para, a.ttsTotalSegments - 1));
            playback.startChapter(a.chapterIndex, clamped);
          }}
        />
      )}

      <View style={styles.controls}>
        {ttsActive && (
          <>
            {/* Tap = previous/next sentence; long-press = previous/next chapter. */}
            <Pressable
              onPress={() => playback.prevSentence()}
              onLongPress={() => playback.prevChapter()}
              delayLongPress={350}
              hitSlop={8}>
              <Ionicons name="play-skip-back" size={22} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => playback.togglePlayback()} hitSlop={8}>
              <Ionicons
                name={isSpeaking && !isPaused ? "pause-circle" : "play-circle"}
                size={30}
                color={colors.text}
              />
            </Pressable>
            <Pressable
              onPress={() => playback.nextSentence()}
              onLongPress={() => playback.nextChapter()}
              delayLongPress={350}
              hitSlop={8}>
              <Ionicons name="play-skip-forward" size={22} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => tts.stop()} hitSlop={8}>
              <Ionicons name="stop-circle" size={24} color={colors.text} />
            </Pressable>
            <Pressable onPress={() => setShowSettings((v) => !v)} hitSlop={8}>
              <Ionicons
                name="options-outline"
                size={22}
                color={showSettings ? "#e67e22" : colors.text}
              />
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

      {ttsActive && showSettings && <VoiceSettings colors={colors} />}

      {isMusicPlaying && <VolumeSlider colors={colors} />}
    </View>
  );
}

/**
 * Seekable read-aloud progress bar (by paragraph). Tap or drag anywhere on the
 * track to jump TTS to that paragraph. Shows a live preview while dragging and
 * only commits the seek on release (restarting TTS mid-drag would be choppy).
 */
function TtsProgress({
  current,
  total,
  colors,
  onSeek,
}: {
  current: number;
  total: number;
  colors: { text: string; muted: string; background: string };
  onSeek: (para: number) => void;
}) {
  const widthRef = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);

  const fracFromX = (x: number) => {
    const w = widthRef.current || 1;
    return Math.max(0, Math.min(1, x / w));
  };
  const frac = drag ?? (total > 0 ? (Math.max(0, current) + 1) / total : 0);
  const shownPara = drag != null && total > 0 ? Math.round(drag * (total - 1)) : Math.max(0, current);

  return (
    <View style={styles.progressWrap}>
      <View
        style={styles.progressTouch}
        onLayout={(e: LayoutChangeEvent) => (widthRef.current = e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e: GestureResponderEvent) => setDrag(fracFromX(e.nativeEvent.locationX))}
        onResponderMove={(e: GestureResponderEvent) => setDrag(fracFromX(e.nativeEvent.locationX))}
        onResponderRelease={(e: GestureResponderEvent) => {
          const f = fracFromX(e.nativeEvent.locationX);
          setDrag(null);
          if (total > 0) onSeek(Math.round(f * (total - 1)));
        }}
        onResponderTerminate={() => setDrag(null)}>
        <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
          <View style={[styles.progressFill, { backgroundColor: colors.text, width: `${frac * 100}%` }]} />
        </View>
      </View>
      <Text style={[styles.progressLabel, { color: colors.muted }]}>
        ¶ {shownPara + 1} / {total || 1}
      </Text>
    </View>
  );
}

/**
 * Quick read-aloud settings: speed / pitch steppers + vi-VN voice picker.
 * Changes persist to the settings store and are pushed into the live session
 * (debounced) — the current sentence restarts with the new options.
 */
function VoiceSettings({ colors }: { colors: { text: string; muted: string; background: string } }) {
  const ttsRate = useSettingsStore((s) => s.ttsRate);
  const ttsPitch = useSettingsStore((s) => s.ttsPitch);
  const ttsVoice = useSettingsStore((s) => s.ttsVoice);
  const [voices, setVoices] = useState<tts.Voice[] | null>(null);

  useEffect(() => {
    let alive = true;
    tts.getVietnameseVoices()
      .then((v) => alive && setVoices(v))
      .catch(() => alive && setVoices([]));
    return () => {
      alive = false;
    };
  }, []);

  const setRate = (delta: number) => {
    useSettingsStore.getState().setTtsRate(Math.round((ttsRate + delta) * 10) / 10);
    playback.applyTtsOptions();
  };
  const setPitch = (delta: number) => {
    useSettingsStore.getState().setTtsPitch(Math.round((ttsPitch + delta) * 10) / 10);
    playback.applyTtsOptions();
  };
  const pickVoice = (identifier?: string) => {
    useSettingsStore.getState().setTtsVoice(identifier);
    playback.applyTtsOptions();
  };

  return (
    <View style={[styles.settings, { borderTopColor: colors.muted }]}>
      <SettingStepper
        label="Tốc độ"
        value={`${ttsRate.toFixed(1)}×`}
        onDec={() => setRate(-0.1)}
        onInc={() => setRate(0.1)}
        colors={colors}
      />
      <SettingStepper
        label="Cao độ"
        value={ttsPitch.toFixed(1)}
        onDec={() => setPitch(-0.1)}
        onInc={() => setPitch(0.1)}
        colors={colors}
      />
      {voices != null && voices.length === 0 ? (
        <Text style={[styles.voiceHint, { color: colors.muted }]}>
          Chưa có giọng tiếng Việt — vào Cài đặt → Trợ năng → Chuyển văn bản thành giọng nói.
        </Text>
      ) : (
        // Devices can expose a dozen vi-VN voices — cap the list so the card
        // stays a compact drawer instead of swallowing the whole screen.
        <ScrollView style={styles.voiceList} nestedScrollEnabled>
          <VoiceRow
            label="Giọng mặc định"
            selected={ttsVoice == null}
            onPress={() => pickVoice(undefined)}
            colors={colors}
          />
          {(voices ?? []).map((v) => (
            <VoiceRow
              key={v.identifier}
              label={v.name}
              selected={ttsVoice === v.identifier}
              onPress={() => pickVoice(v.identifier)}
              colors={colors}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SettingStepper({
  label,
  value,
  onDec,
  onInc,
  colors,
}: {
  label: string;
  value: string;
  onDec: () => void;
  onInc: () => void;
  colors: { text: string; muted: string };
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.stepperLabel, { color: colors.muted }]}>{label}</Text>
      <Pressable onPress={onDec} hitSlop={8}>
        <Ionicons name="remove-circle-outline" size={22} color={colors.text} />
      </Pressable>
      <Text style={[styles.stepperValue, { color: colors.text }]}>{value}</Text>
      <Pressable onPress={onInc} hitSlop={8}>
        <Ionicons name="add-circle-outline" size={22} color={colors.text} />
      </Pressable>
    </View>
  );
}

function VoiceRow({
  label,
  selected,
  onPress,
  colors,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: { text: string; muted: string };
}) {
  return (
    <Pressable onPress={onPress} style={styles.voiceRow} hitSlop={4}>
      <Text
        style={[styles.voiceName, { color: selected ? colors.text : colors.muted }]}
        numberOfLines={1}>
        {label}
      </Text>
      {selected && <Ionicons name="checkmark" size={16} color={colors.text} />}
    </Pressable>
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
  // Bottom-left so it can coexist with the analysis pill (bottom-right).
  pill: {
    position: "absolute",
    left: 12,
    bottom: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  pillText: { fontSize: 13, fontWeight: "700" },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  textCol: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "700" },
  subtitle: { fontSize: 12 },
  controls: { flexDirection: "row", alignItems: "center", gap: 18 },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: 12 },
  progressTouch: { flex: 1, height: 28, justifyContent: "center" },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden", opacity: 0.5 },
  progressFill: { height: 4, borderRadius: 2 },
  progressLabel: { fontSize: 12, fontWeight: "500", minWidth: 56, textAlign: "right" },
  settings: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 6 },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  stepperLabel: { flex: 1, fontSize: 13, fontWeight: "600" },
  stepperValue: { fontSize: 14, fontWeight: "700", minWidth: 44, textAlign: "center" },
  voiceList: { maxHeight: 148 },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  voiceName: { flex: 1, fontSize: 13 },
  voiceHint: { fontSize: 12, lineHeight: 16 },
  volumeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  volTouch: { flex: 1, height: 24, justifyContent: "center" },
  volTrack: { height: 4, borderRadius: 2, overflow: "hidden", opacity: 0.5 },
  volFill: { height: 4, borderRadius: 2 },
});
