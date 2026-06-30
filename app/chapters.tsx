import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useBookStore } from "@/src/store/bookStore";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

export default function ChaptersScreen() {
  const router = useRouter();
  const colors = THEMES[useSettingsStore((s) => s.theme)];
  const book = useBookStore((s) => s.currentBook);
  const chapters = useBookStore((s) => s.chapters);
  const currentChapter = useBookStore((s) => s.currentChapter);
  const jumpTo = useBookStore((s) => s.jumpTo);

  // Prefer stored TOC titles; fall back to chapter count.
  const titles =
    book?.chapterTitles?.length === chapters.length && chapters.length > 0
      ? book.chapterTitles
      : chapters.map((_, i) => `Chapter ${i + 1}`);

  const go = (index: number) => {
    jumpTo(index, 0);
    router.back();
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.bar, { borderBottomColor: colors.muted }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.barTitle, { color: colors.text }]} numberOfLines={1}>
          Chapters
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        data={titles}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => {
          const active = index === currentChapter;
          return (
            <Pressable
              onPress={() => go(index)}
              style={[styles.row, { borderBottomColor: colors.muted }]}>
              <Text style={[styles.num, { color: colors.muted }]}>{index + 1}</Text>
              <Text
                style={[
                  styles.title,
                  { color: colors.text, fontWeight: active ? "700" : "400" },
                ]}
                numberOfLines={2}>
                {item}
              </Text>
              {active && <Ionicons name="play" size={14} color={colors.text} />}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
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
  list: { paddingHorizontal: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  num: { fontSize: 13, minWidth: 24, textAlign: "right" },
  title: { flex: 1, fontSize: 15 },
});
