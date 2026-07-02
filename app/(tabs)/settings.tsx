import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { Directory, Paths } from "expo-file-system";
import { useCallback } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { resetDatabase } from "@/src/services/db";
import * as playback from "@/src/services/playbackSession";
import { useBookStore } from "@/src/store/bookStore";
import {
  FONT_FAMILIES,
  FontFamily,
  THEMES,
  ThemeName,
  useSettingsStore,
} from "@/src/store/settingsStore";

const THEME_NAMES: ThemeName[] = ["white", "sepia", "dark", "black"];

export default function SettingsScreen() {
  const s = useSettingsStore();
  const colors = THEMES[s.theme];

  const clearAllData = useCallback(() => {
    Alert.alert(
      "Clear all data",
      "Delete all imported books, bookmarks, and reset settings? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete everything",
          style: "destructive",
          onPress: async () => {
            resetDatabase();
            // Remove imported book files + covers.
            try {
              const dir = new Directory(Paths.document, "books");
              if (dir.exists) dir.delete();
            } catch {
              /* best effort */
            }
            await AsyncStorage.clear();
            useBookStore.getState().reset();
            Alert.alert("Done", "All data cleared. Reload the app for a fresh start.");
          },
        },
      ],
    );
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.heading, { color: colors.text }]}>Settings</Text>

        {/* Theme */}
        <Text style={[styles.label, { color: colors.muted }]}>Theme</Text>
        <View style={styles.swatchRow}>
          {THEME_NAMES.map((name) => {
            const t = THEMES[name];
            const selected = s.theme === name;
            return (
              <Pressable
                key={name}
                onPress={() => s.setTheme(name)}
                style={[
                  styles.swatch,
                  { backgroundColor: t.background, borderColor: selected ? colors.text : t.muted },
                  selected && styles.swatchSelected,
                ]}>
                <Text style={{ color: t.text, fontSize: 13 }}>Aa</Text>
                {selected && (
                  <Ionicons name="checkmark-circle" size={16} color={colors.text} style={styles.check} />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* Font family */}
        <Text style={[styles.label, { color: colors.muted }]}>Font</Text>
        <View style={styles.pillRow}>
          {FONT_FAMILIES.map((f: FontFamily) => {
            const selected = s.fontFamily === f;
            return (
              <Pressable
                key={f}
                onPress={() => s.setFontFamily(f)}
                style={[
                  styles.pill,
                  { borderColor: colors.text, backgroundColor: selected ? colors.text : "transparent" },
                ]}>
                <Text style={{ color: selected ? colors.background : colors.text, fontWeight: "600" }}>
                  {f}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Font size */}
        <Stepper
          label="Font size"
          value={`${s.fontSize}px`}
          onDec={() => s.setFontSize(s.fontSize - 1)}
          onInc={() => s.setFontSize(s.fontSize + 1)}
          colors={colors}
        />

        {/* Line height */}
        <Stepper
          label="Line spacing"
          value={s.lineHeight.toFixed(1)}
          onDec={() => s.setLineHeight(Math.round((s.lineHeight - 0.1) * 10) / 10)}
          onInc={() => s.setLineHeight(Math.round((s.lineHeight + 0.1) * 10) / 10)}
          colors={colors}
        />

        <Text style={[styles.preview, { color: colors.text, fontSize: s.fontSize, lineHeight: s.fontSize * s.lineHeight, fontFamily: s.fontFamily === "System" ? undefined : s.fontFamily }]}>
          The quick brown fox jumps over the lazy dog. Đêm khuya trăng sáng, gió
          thổi nhẹ qua rặng tre.
        </Text>

        {/* Read-aloud (TTS) */}
        <Text style={[styles.label, { color: colors.muted }]}>Read-aloud</Text>
        <Stepper
          label="Speed"
          value={`${s.ttsRate.toFixed(1)}×`}
          onDec={() => {
            s.setTtsRate(Math.round((s.ttsRate - 0.1) * 10) / 10);
            playback.applyTtsOptions(); // live-apply to a running read-aloud
          }}
          onInc={() => {
            s.setTtsRate(Math.round((s.ttsRate + 0.1) * 10) / 10);
            playback.applyTtsOptions();
          }}
          colors={colors}
        />
        <Stepper
          label="Pitch"
          value={s.ttsPitch.toFixed(1)}
          onDec={() => {
            s.setTtsPitch(Math.round((s.ttsPitch - 0.1) * 10) / 10);
            playback.applyTtsOptions();
          }}
          onInc={() => {
            s.setTtsPitch(Math.round((s.ttsPitch + 0.1) * 10) / 10);
            playback.applyTtsOptions();
          }}
          colors={colors}
        />
        <Text style={[styles.hint, { color: colors.muted }]}>
          Vietnamese (vi-VN) voice. Install one via Android Settings → Accessibility → Text-to-speech
          if read-aloud is silent.
        </Text>

        {/* Data */}
        <Text style={[styles.label, { color: colors.muted }]}>Data</Text>
        <Pressable
          onPress={clearAllData}
          style={({ pressed }) => [
            styles.dangerBtn,
            { borderColor: "#c0392b", opacity: pressed ? 0.6 : 1 },
          ]}>
          <Ionicons name="trash-outline" size={18} color="#c0392b" />
          <Text style={styles.dangerText}>Clear all data</Text>
        </Pressable>
        <Text style={[styles.hint, { color: colors.muted }]}>
          Removes all books, bookmarks, and settings. Useful for testing from a clean slate.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stepper({
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
  colors: { text: string; muted: string; background: string };
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.label, { color: colors.muted, marginTop: 0 }]}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable onPress={onDec} hitSlop={8} style={[styles.stepBtn, { borderColor: colors.text }]}>
          <Ionicons name="remove" size={18} color={colors.text} />
        </Pressable>
        <Text style={[styles.stepValue, { color: colors.text }]}>{value}</Text>
        <Pressable onPress={onInc} hitSlop={8} style={[styles.stepBtn, { borderColor: colors.text }]}>
          <Ionicons name="add" size={18} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 30, fontWeight: "700", marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 24, marginBottom: 10 },
  swatchRow: { flexDirection: "row", gap: 12 },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  swatchSelected: { borderWidth: 3 },
  check: { position: "absolute", top: 2, right: 2 },
  pillRow: { flexDirection: "row", gap: 10 },
  pill: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  stepperRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 24 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16 },
  stepBtn: { borderWidth: 1, borderRadius: 8, padding: 6 },
  stepValue: { fontSize: 16, fontWeight: "600", minWidth: 44, textAlign: "center" },
  preview: { marginTop: 28 },
  dangerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
  },
  dangerText: { color: "#c0392b", fontSize: 16, fontWeight: "600" },
  hint: { fontSize: 12, marginTop: 8, lineHeight: 18 },
});
