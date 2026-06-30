import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  getAllBooks,
  getBook,
  getChapters,
  searchContent,
  type SearchHit,
} from "@/src/services/db";
import { useBookStore } from "@/src/store/bookStore";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

/** Split an FTS snippet on the [..] match markers so we can bold matches. */
function renderSnippet(snippet: string, color: string, matchColor: string) {
  const parts = snippet.split(/\[(.*?)\]/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <Text key={i} style={{ color: matchColor, fontWeight: "700" }}>
        {part}
      </Text>
    ) : (
      <Text key={i} style={{ color }}>
        {part}
      </Text>
    ),
  );
}

export default function SearchScreen() {
  const router = useRouter();
  const { bookId } = useLocalSearchParams<{ bookId?: string }>();
  const colors = THEMES[useSettingsStore((s) => s.theme)];
  const setCurrentBook = useBookStore((s) => s.setCurrentBook);
  const setChapters = useBookStore((s) => s.setChapters);
  const jumpTo = useBookStore((s) => s.jumpTo);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);

  // bookId → title, loaded once.
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of getAllBooks()) map.set(b.id, b.title);
    return map;
  }, []);
  const scopeTitle = bookId ? titles.get(bookId) : undefined;

  // Debounced live search, scoped to one book when bookId is given.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const id = setTimeout(() => setHits(searchContent(q, bookId)), 250);
    return () => clearTimeout(id);
  }, [query, bookId]);

  const open = (hit: SearchHit) => {
    const book = getBook(hit.bookId);
    if (!book) return;
    setCurrentBook(book);
    setChapters(getChapters(book.id));
    jumpTo(hit.chapterIndex, 0);
    router.navigate("/reader");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={[styles.inputWrap, { borderColor: colors.muted }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={scopeTitle ? `Search in “${scopeTitle}”…` : "Search all books…"}
            placeholderTextColor={colors.muted}
            autoFocus
            style={[styles.input, { color: colors.text }]}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <FlatList
        data={hits}
        keyExtractor={(h, i) => `${h.bookId}_${h.chapterIndex}_${i}`}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {query.trim() ? "No matches found." : "Type to search your library."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => open(item)}
            style={[styles.row, { borderBottomColor: colors.muted }]}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {bookId ? (
                `Chapter ${item.chapterIndex + 1}`
              ) : (
                <>
                  {titles.get(item.bookId) ?? "Unknown book"}
                  <Text style={{ color: colors.muted, fontWeight: "400" }}>
                    {"  ·  Ch. "}
                    {item.chapterIndex + 1}
                  </Text>
                </>
              )}
            </Text>
            <Text style={styles.snippet} numberOfLines={3}>
              {renderSnippet(item.snippet, colors.muted, colors.text)}
            </Text>
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
    gap: 10,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  inputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 42,
  },
  input: { flex: 1, fontSize: 16, padding: 0 },
  list: { flexGrow: 1, paddingHorizontal: 4 },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 15, fontWeight: "600" },
  snippet: { fontSize: 14, lineHeight: 20 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyText: { fontSize: 15, textAlign: "center" },
});
