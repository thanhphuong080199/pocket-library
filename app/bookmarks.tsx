import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { deleteBookmark, getBookmarks, type Bookmark } from "@/src/services/db";
import { useBookStore } from "@/src/store/bookStore";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

export default function BookmarksScreen() {
  const router = useRouter();
  const colors = THEMES[useSettingsStore((s) => s.theme)];
  const book = useBookStore((s) => s.currentBook);
  const jumpToParagraph = useBookStore((s) => s.jumpToParagraph);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const reload = useCallback(() => {
    setBookmarks(book ? getBookmarks(book.id) : []);
  }, [book]);
  useFocusEffect(reload);

  const jump = useCallback(
    (bm: Bookmark) => {
      jumpToParagraph(bm.chapterIndex, bm.paragraphIndex);
      router.navigate("/reader");
    },
    [jumpToParagraph, router],
  );

  const remove = useCallback(
    (id: string) => {
      deleteBookmark(id);
      reload();
    },
    [reload],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.bar, { borderBottomColor: colors.muted }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.barTitle, { color: colors.text }]} numberOfLines={1}>
          Bookmarks
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        data={bookmarks}
        keyExtractor={(b) => b.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="bookmark-outline" size={44} color={colors.muted} />
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              No bookmarks yet. Tap the bookmark icon while reading to save your spot.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => jump(item)}
            style={[styles.row, { borderBottomColor: colors.muted }]}>
            <View style={styles.rowMain}>
              {item.highlight ? (
                <Text style={[styles.excerpt, { color: colors.text }]} numberOfLines={3}>
                  {item.highlight}
                </Text>
              ) : (
                <Text style={[styles.excerpt, { color: colors.text }]}>
                  Chapter {item.chapterIndex + 1}
                </Text>
              )}
              <Text style={[styles.date, { color: colors.muted }]}>
                Chapter {item.chapterIndex + 1} · {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
            <Pressable onPress={() => remove(item.id)} hitSlop={10}>
              <Ionicons name="trash-outline" size={20} color={colors.muted} />
            </Pressable>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600" },
  list: { flexGrow: 1, paddingHorizontal: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, gap: 4 },
  excerpt: { fontSize: 15, lineHeight: 21 },
  date: { fontSize: 12 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
});
