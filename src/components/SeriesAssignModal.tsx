/**
 * Series-assign step of the import flow (Phase 5 Step B).
 *
 * Shown after a file is picked + parsed but before anything hits the DB:
 * the user chooses whether the book is standalone, starts a new series, or
 * joins an existing series as volume N (feeding the accumulative KB).
 */
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import type { SeriesAssignment, StagedImport } from "@/src/services/import";
import { getSeriesCandidates, type SeriesCandidate } from "@/src/services/seriesManager";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

type Mode = "standalone" | "new" | "existing";

interface Props {
  staged: StagedImport | null;
  onConfirm: (assignment: SeriesAssignment) => void;
  onCancel: () => void;
}

export function SeriesAssignModal({ staged, onConfirm, onCancel }: Props) {
  const theme = useSettingsStore((s) => s.theme);
  const colors = THEMES[theme];

  const [mode, setMode] = useState<Mode>("standalone");
  const [seriesName, setSeriesName] = useState("");
  const [selected, setSelected] = useState<SeriesCandidate | null>(null);
  const [volume, setVolume] = useState(1);

  // Candidates reload every time the dialog opens (imports change the list).
  const candidates = useMemo(() => (staged ? getSeriesCandidates() : []), [staged]);

  // Reset per staged book.
  useEffect(() => {
    if (staged) {
      setMode("standalone");
      setSeriesName(staged.title);
      setSelected(null);
      setVolume(1);
    }
  }, [staged]);

  const pickCandidate = (c: SeriesCandidate) => {
    setSelected(c);
    setVolume(c.nextVolume);
  };

  const confirmDisabled =
    (mode === "new" && seriesName.trim().length === 0) ||
    (mode === "existing" && !selected);

  const confirm = () => {
    if (mode === "standalone") return onConfirm({ kind: "standalone" });
    if (mode === "new")
      return onConfirm({ kind: "new", name: seriesName.trim(), volumeNumber: volume });
    if (selected)
      return onConfirm({ kind: "existing", seriesId: selected.id, volumeNumber: volume });
  };

  const OptionRow = ({ value, label }: { value: Mode; label: string }) => (
    <Pressable style={styles.optionRow} onPress={() => setMode(value)}>
      <Ionicons
        name={mode === value ? "radio-button-on" : "radio-button-off"}
        size={20}
        color={colors.text}
      />
      <Text style={[styles.optionLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );

  const VolumeStepper = () => (
    <View style={styles.volumeRow}>
      <Text style={[styles.volumeLabel, { color: colors.muted }]}>Volume</Text>
      <Pressable
        onPress={() => setVolume((v) => Math.max(1, v - 1))}
        style={[styles.stepBtn, { borderColor: colors.muted }]}
        hitSlop={6}>
        <Ionicons name="remove" size={16} color={colors.text} />
      </Pressable>
      <Text style={[styles.volumeValue, { color: colors.text }]}>{volume}</Text>
      <Pressable
        onPress={() => setVolume((v) => v + 1)}
        style={[styles.stepBtn, { borderColor: colors.muted }]}
        hitSlop={6}>
        <Ionicons name="add" size={16} color={colors.text} />
      </Pressable>
    </View>
  );

  return (
    <Modal
      visible={!!staged}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.background }]}>
          <Text style={[styles.heading, { color: colors.text }]}>Add to library</Text>
          <Text style={[styles.bookTitle, { color: colors.muted }]} numberOfLines={2}>
            {staged?.title}
            {staged?.author ? ` — ${staged.author}` : ""}
          </Text>

          <OptionRow value="standalone" label="Standalone book" />
          <OptionRow value="new" label="Start a new series" />
          {mode === "new" && (
            <View style={styles.indent}>
              <TextInput
                value={seriesName}
                onChangeText={setSeriesName}
                placeholder="Series name"
                placeholderTextColor={colors.muted}
                style={[
                  styles.input,
                  { color: colors.text, borderColor: colors.muted },
                ]}
              />
              <VolumeStepper />
            </View>
          )}

          {candidates.length > 0 && (
            <>
              <OptionRow value="existing" label="Add to existing series" />
              {mode === "existing" && (
                <View style={styles.indent}>
                  <FlatList
                    data={candidates}
                    keyExtractor={(c) => c.id}
                    style={styles.candidateList}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({ item }) => (
                      <Pressable
                        style={styles.candidateRow}
                        onPress={() => pickCandidate(item)}>
                        <Ionicons
                          name={
                            selected?.id === item.id
                              ? "checkmark-circle"
                              : "ellipse-outline"
                          }
                          size={18}
                          color={colors.text}
                        />
                        <Text
                          style={[styles.candidateName, { color: colors.text }]}
                          numberOfLines={1}>
                          {item.name}
                        </Text>
                        <Text style={[styles.candidateVols, { color: colors.muted }]}>
                          {item.volumeCount} vol{item.volumeCount === 1 ? "" : "s"}
                        </Text>
                      </Pressable>
                    )}
                  />
                  {selected && <VolumeStepper />}
                </View>
              )}
            </>
          )}

          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.actionBtn} hitSlop={6}>
              <Text style={[styles.actionText, { color: colors.muted }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={confirm}
              disabled={confirmDisabled}
              style={[styles.actionBtn, { opacity: confirmDisabled ? 0.4 : 1 }]}
              hitSlop={6}>
              <Text style={[styles.actionText, styles.actionPrimary, { color: colors.text }]}>
                Add
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  card: { borderRadius: 14, padding: 20 },
  heading: { fontSize: 19, fontWeight: "700", marginBottom: 4 },
  bookTitle: { fontSize: 14, marginBottom: 14 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
  },
  optionLabel: { fontSize: 15, fontWeight: "500" },
  indent: { marginLeft: 30, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 15,
    marginBottom: 8,
  },
  candidateList: { maxHeight: 180, marginBottom: 8 },
  candidateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  candidateName: { flex: 1, fontSize: 14 },
  candidateVols: { fontSize: 12 },
  volumeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  volumeLabel: { fontSize: 13, marginRight: 2 },
  stepBtn: {
    borderWidth: 1,
    borderRadius: 6,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  volumeValue: { fontSize: 15, fontWeight: "600", minWidth: 22, textAlign: "center" },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 22,
    marginTop: 14,
  },
  actionBtn: { paddingVertical: 6 },
  actionText: { fontSize: 15, fontWeight: "600" },
  actionPrimary: { fontWeight: "700" },
});
