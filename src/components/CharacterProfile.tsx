/**
 * Shared knowledge-base display components (Phase 5): the labeled character
 * profile card, its life-history timeline, and the power-stage row. Used by
 * the book detail page, the character screen, and the series view.
 */
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  getCharacterEvents,
  type Character,
  type CharacterEvent,
  type PowerStage,
} from "@/src/services/db";

export type KBColors = { text: string; muted: string };

/** Vietnamese display labels for the model's English role values. */
export const ROLE_LABELS_VI: Record<string, string> = {
  protagonist: "Nhân vật chính",
  antagonist: "Phản diện",
  supporting: "Nhân vật phụ",
};

export function roleLabel(role?: string): string | undefined {
  return role ? (ROLE_LABELS_VI[role.toLowerCase()] ?? role) : undefined;
}

export function PowerStageRow({ stage, colors }: { stage: PowerStage; colors: KBColors }) {
  return (
    <View style={styles.psRow}>
      <Text style={[styles.psName, { color: colors.text }]}>{stage.stageName}</Text>
      {!!stage.description && (
        <Text style={[styles.charLine, { color: colors.muted }]}>{stage.description}</Text>
      )}
    </View>
  );
}

/** Labeled character profile (Name / Gender / Power / …) from the series KB. */
export function CharacterCard({
  character,
  colors,
  onPress,
}: {
  character: Character;
  colors: KBColors;
  /** When set, the card becomes tappable (→ character detail screen). */
  onPress?: () => void;
}) {
  const c = character;
  // Reload the life-history events whenever this character advances in the book.
  const events = useMemo(
    () => getCharacterEvents(c.id),
    [c.id, c.lastSeenVolume, c.lastSeenChapter], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Relationships: "relation" is stored from THIS character's point of view — it
  // states what the named person is TO this character (see deltaExtractor prompt),
  // so "B (vợ)" on A's card means B is A's wife.
  const rels = c.relationships.map((r) => `${r.name} (${r.relation})`).join(", ");
  // Merge Strengths (current realm/power) and Skills into one field — they
  // overlap heavily in practice, so a single line reads cleaner.
  const powerAndSkills = [c.currentPower, c.skills.join(", ")].filter(Boolean).join(" · ");

  const body = (
    <>
      <Text style={[styles.charName, { color: colors.text }]}>{c.name}</Text>
      <Field label="Giới tính" value={c.gender} colors={colors} />
      <Field label="Vai trò" value={roleLabel(c.role)} colors={colors} />
      <Field label="Sức mạnh & kỹ năng" value={powerAndSkills} colors={colors} />
      <Field label="Thế lực" value={c.faction} colors={colors} />
      <Field label="Biệt danh" value={c.aliases.join(", ")} colors={colors} />
      <Field label="Quan hệ" value={rels} colors={colors} />
      <Field label="Tính cách" value={c.personality} colors={colors} />
      <Field label="Trạng thái" value={c.status} colors={colors} />
      <Field label="Ngoại hình" value={c.appearance} colors={colors} />
      <Field label="Lai lịch" value={c.backstory} colors={colors} />
      <LifeHistory events={events} colors={colors} />
    </>
  );

  if (onPress) {
    return (
      <Pressable style={[styles.charCard, { borderColor: colors.muted }]} onPress={onPress}>
        {body}
      </Pressable>
    );
  }
  return <View style={[styles.charCard, { borderColor: colors.muted }]}>{body}</View>;
}

/**
 * Character life history: the full append-only event log in chronological order
 * (getCharacterEvents already sorts by volume then chapter), not just the latest
 * overwritten backstory. When events span multiple volumes (series KB), each
 * entry is prefixed with its volume.
 */
export function LifeHistory({ events, colors }: { events: CharacterEvent[]; colors: KBColors }) {
  const visible = events.filter((e) => e.description.trim().length > 0);
  if (visible.length === 0) return null;
  const multiVolume = new Set(visible.map((e) => e.volume)).size > 1;
  return (
    <View style={styles.timeline}>
      <Text style={[styles.charLine, { color: colors.muted, fontWeight: "600" }]}>Tiểu sử:</Text>
      {visible.map((e) => {
        const where = [
          multiVolume ? `Tập ${e.volume}` : "",
          e.chapter > 0 ? `Chương ${e.chapter + 1}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <Text key={e.id} style={[styles.timelineItem, { color: colors.text }]}>
            {"• "}
            {!!where && <Text style={{ color: colors.muted }}>{`${where}: `}</Text>}
            {e.description}
          </Text>
        );
      })}
    </View>
  );
}

/** A labeled `Label: value` line; renders nothing when the value is empty. */
export function Field({
  label,
  value,
  colors,
}: {
  label: string;
  value?: string;
  colors: KBColors;
}) {
  if (!value) return null;
  return (
    <Text style={[styles.charLine, { color: colors.text }]}>
      <Text style={{ color: colors.muted, fontWeight: "600" }}>{label}: </Text>
      {value}
    </Text>
  );
}

const styles = StyleSheet.create({
  charCard: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  charName: { fontSize: 16, fontWeight: "700", marginBottom: 2 },
  charLine: { fontSize: 13, lineHeight: 19 },
  timeline: { marginTop: 4, gap: 3 },
  timelineItem: { fontSize: 13, lineHeight: 19, paddingLeft: 4 },
  psRow: { gap: 2 },
  psName: { fontSize: 15, fontWeight: "600" },
});
