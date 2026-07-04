/**
 * All characters of a series (from the KB), as a virtualized, searchable list.
 * The book detail page shows only a short preview of the main cast and links
 * here — profile cards are tall, and a webnovel can extract 50+ characters, so
 * the full set needs a FlatList + search instead of inline cards.
 */
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { roleLabel } from "@/src/components/CharacterProfile";
import { getCharacters, type Character } from "@/src/services/db";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";
import { normalizeVietnamese } from "@/src/utils/text";

/** Loose role buckets — role strings come from the AI (see db.getCharacters). */
type RoleFilter = "all" | "protagonist" | "antagonist" | "supporting";

const FILTERS: { key: RoleFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "protagonist", label: "Chính" },
  { key: "antagonist", label: "Phản diện" },
  { key: "supporting", label: "Phụ" },
];

function roleBucket(role?: string): RoleFilter {
  const r = (role ?? "").toLowerCase();
  if (/protagonist|main|chính/.test(r)) return "protagonist";
  if (/antagonist|villain|phản/.test(r)) return "antagonist";
  return "supporting";
}

export default function CharactersScreen() {
  const { seriesId } = useLocalSearchParams<{ seriesId: string }>();
  const router = useRouter();
  const colors = THEMES[useSettingsStore((s) => s.theme)];

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RoleFilter>("all");

  // Already ordered by plot importance (protagonist → … → side cast).
  const all = useMemo(() => (seriesId ? getCharacters(seriesId) : []), [seriesId]);

  const shown = useMemo(() => {
    const q = normalizeVietnamese(query);
    return all.filter((c) => {
      if (filter !== "all" && roleBucket(c.role) !== filter) return false;
      if (!q) return true;
      return [c.name, ...c.aliases, c.faction ?? ""].some((s) =>
        normalizeVietnamese(s).includes(q),
      );
    });
  }, [all, query, filter]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.bar, { borderBottomColor: colors.muted }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.barTitle, { color: colors.text }]} numberOfLines={1}>
          Nhân vật ({all.length})
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.controls}>
        <View style={[styles.searchBox, { borderColor: colors.muted }]}>
          <Ionicons name="search" size={16} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Tìm theo tên, biệt danh, thế lực…"
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.muted} />
            </Pressable>
          )}
        </View>
        <View style={styles.chips}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[
                  styles.chip,
                  { borderColor: colors.muted },
                  active && { backgroundColor: colors.text, borderColor: colors.text },
                ]}>
                <Text style={{ color: active ? colors.background : colors.text, fontSize: 13 }}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.muted }]}>
            {all.length === 0
              ? "Chưa có nhân vật nào — hãy chạy phân tích truyện."
              : "Không tìm thấy nhân vật phù hợp."}
          </Text>
        }
        renderItem={({ item }) => <CharacterRow character={item} colors={colors} router={router} />}
      />
    </SafeAreaView>
  );
}

function CharacterRow({
  character: c,
  colors,
  router,
}: {
  character: Character;
  colors: { text: string; muted: string };
  router: ReturnType<typeof useRouter>;
}) {
  const sub = [roleLabel(c.role), c.currentPower, c.faction].filter(Boolean).join(" · ");
  return (
    <Pressable
      onPress={() => router.navigate({ pathname: "/character/[id]", params: { id: c.id } })}
      style={[styles.row, { borderBottomColor: colors.muted }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowName, { color: colors.text }]} numberOfLines={1}>
          {c.name}
          {c.status?.toLowerCase().includes("chết") ? " ✝" : ""}
        </Text>
        {!!sub && (
          <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600" },
  controls: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 8 },
  chips: { flexDirection: "row", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  list: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 32 },
  empty: { fontSize: 14, fontStyle: "italic", textAlign: "center", marginTop: 32 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowName: { fontSize: 15, fontWeight: "600" },
  rowSub: { fontSize: 13 },
});
