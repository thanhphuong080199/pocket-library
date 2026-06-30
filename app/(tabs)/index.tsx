import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { deleteBook, getAllBooks, type Book } from "@/src/services/db";
import { ImportError, importBook } from "@/src/services/import";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

export default function LibraryScreen() {
  const router = useRouter();
  const theme = useSettingsStore((s) => s.theme);
  const colors = THEMES[theme];

  const [books, setBooks] = useState<Book[]>([]);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState("");

  const reload = useCallback(() => setBooks(getAllBooks()), []);
  useFocusEffect(reload);

  // Library search = title + author filter only (content search lives in the
  // book detail page). Diacritic-insensitive-ish via simple lowercase match.
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) || (b.author ?? "").toLowerCase().includes(q),
    );
  }, [books, filter]);

  const onImport = useCallback(async () => {
    setImporting(true);
    try {
      const bookId = await importBook();
      if (bookId) reload();
    } catch (err) {
      const msg =
        err instanceof ImportError ? err.message : "Something went wrong importing.";
      Alert.alert("Import failed", msg);
    } finally {
      setImporting(false);
    }
  }, [reload]);

  const openBook = useCallback(
    (book: Book) => {
      router.navigate({ pathname: "/book/[id]", params: { id: book.id } });
    },
    [router],
  );

  const confirmDelete = useCallback(
    (book: Book) => {
      Alert.alert("Delete book", `Remove “${book.title}” from your library?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            deleteBook(book.id);
            reload();
          },
        },
      ]);
    },
    [reload],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.heading, { color: colors.text }]}>Library</Text>
        <Pressable
          onPress={onImport}
          disabled={importing}
          style={({ pressed }) => [
            styles.importBtn,
            { borderColor: colors.text, opacity: pressed || importing ? 0.5 : 1 },
          ]}>
          {importing ? (
            <ActivityIndicator color={colors.text} size="small" />
          ) : (
            <Ionicons name="add" size={20} color={colors.text} />
          )}
          <Text style={[styles.importText, { color: colors.text }]}>
            {importing ? "Importing…" : "Import"}
          </Text>
        </Pressable>
      </View>

      {books.length > 0 && (
        <View style={[styles.searchWrap, { borderColor: colors.muted }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput
            value={filter}
            onChangeText={setFilter}
            placeholder="Filter by title or author…"
            placeholderTextColor={colors.muted}
            style={[styles.searchInput, { color: colors.text }]}
          />
          {filter.length > 0 && (
            <Pressable onPress={() => setFilter("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      )}

      <FlatList
        data={visible}
        keyExtractor={(b) => b.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="book-outline" size={48} color={colors.muted} />
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {filter.trim()
                ? "No books match your filter."
                : "No books yet. Tap Import to add an EPUB, PDF, or DOCX."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.card}
            onPress={() => openBook(item)}
            onLongPress={() => confirmDelete(item)}>
            <View style={[styles.cover, { backgroundColor: colors.muted }]}>
              {item.coverUrl ? (
                <Image
                  source={{ uri: item.coverUrl }}
                  style={styles.coverImg}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View style={styles.coverFallback}>
                  <Text style={styles.coverFallbackText} numberOfLines={4}>
                    {item.title}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
              {item.title}
            </Text>
            {!!item.author && (
              <Text style={[styles.author, { color: colors.muted }]} numberOfLines={1}>
                {item.author}
              </Text>
            )}
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  heading: { fontSize: 30, fontWeight: "700" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  importText: { fontSize: 15, fontWeight: "600" },
  list: { paddingHorizontal: 12, paddingBottom: 24, flexGrow: 1 },
  row: { gap: 12 },
  card: { flex: 1, marginBottom: 20, maxWidth: "50%" },
  cover: {
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: "hidden",
    marginBottom: 6,
  },
  coverImg: { width: "100%", height: "100%" },
  coverFallback: { flex: 1, padding: 10, justifyContent: "center" },
  coverFallbackText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  title: { fontSize: 14, fontWeight: "600" },
  author: { fontSize: 12, marginTop: 2 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
});
