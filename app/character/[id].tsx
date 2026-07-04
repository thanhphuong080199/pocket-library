/**
 * Character profile screen (Phase 5 Step B): the accumulated current state of
 * one character from the series knowledge base, plus their full life-history
 * timeline (`character_events`, chronological across volumes).
 */
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Field, LifeHistory, roleLabel } from "@/src/components/CharacterProfile";
import { getCharacter, getCharacterEvents, getSeries } from "@/src/services/db";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

export default function CharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = THEMES[useSettingsStore((s) => s.theme)];

  const character = useMemo(() => (id ? getCharacter(id) : null), [id]);
  const events = useMemo(() => (id ? getCharacterEvents(id) : []), [id]);
  const seriesName = useMemo(
    () => (character ? getSeries(character.seriesId)?.name : undefined),
    [character],
  );

  if (!character) {
    return (
      <SafeAreaView
        style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.muted }}>Không tìm thấy nhân vật.</Text>
      </SafeAreaView>
    );
  }

  const c = character;
  const rels = c.relationships.map((r) => `${r.name} (${r.relation})`).join(", ");
  const powerAndSkills = [c.currentPower, c.skills.join(", ")].filter(Boolean).join(" · ");

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.name, { color: colors.text }]}>{c.name}</Text>
        {!!seriesName && (
          <Text style={[styles.series, { color: colors.muted }]}>{seriesName}</Text>
        )}

        <View style={[styles.card, { borderColor: colors.muted, marginTop: 16 }]}>
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
        </View>

        <View style={[styles.card, { borderColor: colors.muted, marginTop: 16 }]}>
          {events.some((e) => e.description.trim().length > 0) ? (
            <LifeHistory events={events} colors={colors} />
          ) : (
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              Chưa có sự kiện nào được ghi nhận cho nhân vật này.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  topBar: { paddingHorizontal: 16, paddingBottom: 4 },
  content: { padding: 20, paddingBottom: 48 },
  name: { fontSize: 24, fontWeight: "700" },
  series: { fontSize: 14, marginTop: 2 },
  card: { borderWidth: 1, borderRadius: 10, padding: 14, gap: 4 },
  placeholder: { fontSize: 14, fontStyle: "italic", lineHeight: 20 },
});
