/**
 * App-wide floating banner for the background knowledge-base analysis. Visible
 * on every screen while a job is running/paused/failed so the user can watch
 * progress, resume after a rate-limit pause, cancel, or dismiss — without
 * having to be on the book's detail page.
 */
import { Ionicons } from "@expo/vector-icons";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { cancelAnalysis, dismissJob, resumeSeries } from "@/src/services/kbRunner";
import { useKBStore } from "@/src/store/kbStore";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

export function KbProgressBanner() {
  const colors = THEMES[useSettingsStore((s) => s.theme)];
  const job = useKBStore((s) => s.job);
  const status = useKBStore((s) => s.status);
  const error = useKBStore((s) => s.error);

  // Auto-hide the "done" banner after a moment.
  useEffect(() => {
    if (status !== "done") return;
    const t = setTimeout(dismissJob, 4000);
    return () => clearTimeout(t);
  }, [status]);

  if (!job || status === "idle") return null;

  const frac = job.total > 0 ? Math.min(1, job.current / job.total) : 0;
  const running = status === "running";
  const done = status === "done";

  const headline = running
    ? `Analyzing “${job.title}”`
    : done
      ? "Knowledge base ready"
      : status === "error"
        ? "Analysis paused"
        : "Analysis paused";

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, borderColor: colors.muted }]}>
      <View style={styles.headerRow}>
        <Ionicons
          name={done ? "checkmark-circle" : running ? "sparkles" : "pause-circle"}
          size={18}
          color={colors.text}
        />
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {headline}
        </Text>
        <Text style={[styles.count, { color: colors.muted }]}>
          {job.current}/{job.total}
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <View style={[styles.fill, { backgroundColor: colors.text, width: `${frac * 100}%` }]} />
      </View>

      {!!error && (status === "paused" || status === "error") && (
        <Text style={[styles.msg, { color: colors.muted }]} numberOfLines={2}>
          {error}
        </Text>
      )}

      <View style={styles.actions}>
        {running ? (
          <BannerAction label="Cancel" color={colors.muted} onPress={cancelAnalysis} />
        ) : done ? (
          <BannerAction label="Dismiss" color={colors.muted} onPress={dismissJob} />
        ) : (
          <>
            <BannerAction label="Resume" color={colors.text} onPress={() => resumeSeries(job.seriesId)} />
            <BannerAction label="Dismiss" color={colors.muted} onPress={dismissJob} />
          </>
        )}
      </View>
    </View>
  );
}

function BannerAction({
  label,
  color,
  onPress,
}: {
  label: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.action}>
      <Text style={{ color, fontSize: 13, fontWeight: "700" }}>{label}</Text>
    </Pressable>
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
    padding: 12,
    gap: 8,
    // Float above content.
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 14, fontWeight: "700" },
  count: { fontSize: 12, fontWeight: "600" },
  track: { height: 4, borderRadius: 2, overflow: "hidden", opacity: 0.4 },
  fill: { height: 4, borderRadius: 2 },
  msg: { fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 18 },
  action: { paddingVertical: 2 },
});
