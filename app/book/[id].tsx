import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { getBook, getChapters } from "@/src/services/db";
import { useBookStore } from "@/src/store/bookStore";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

export default function BookDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = THEMES[useSettingsStore((s) => s.theme)];

  const setCurrentBook = useBookStore((s) => s.setCurrentBook);
  const setChapters = useBookStore((s) => s.setChapters);
  const jumpTo = useBookStore((s) => s.jumpTo);

  const book = useMemo(() => (id ? getBook(id) : null), [id]);

  // Load this book into the reader context so Read / Search / Bookmarks work.
  useEffect(() => {
    if (!book) return;
    setCurrentBook(book);
    setChapters(getChapters(book.id));
  }, [book, setCurrentBook, setChapters]);

  if (!book) {
    return (
      <SafeAreaView style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.muted }}>Book not found.</Text>
      </SafeAreaView>
    );
  }

  const titles = book.chapterTitles?.length
    ? book.chapterTitles
    : Array.from({ length: book.totalChapters ?? 0 }, (_, i) => `Chapter ${i + 1}`);
  const resumeChapter = book.lastPosition?.chapterIndex ?? 0;
  const hasProgress = resumeChapter > 0 || (book.lastPosition?.scrollY ?? 0) > 0;

  const read = (chapterIndex?: number) => {
    if (chapterIndex != null) jumpTo(chapterIndex, 0);
    router.navigate("/reader");
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={[styles.cover, { backgroundColor: colors.muted }]}>
            {book.coverUrl ? (
              <Image source={{ uri: book.coverUrl }} style={styles.coverImg} contentFit="cover" />
            ) : (
              <View style={styles.coverFallback}>
                <Text style={styles.coverFallbackText} numberOfLines={5}>
                  {book.title}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.headerInfo}>
            <Text style={[styles.title, { color: colors.text }]}>{book.title}</Text>
            {!!book.author && (
              <Text style={[styles.author, { color: colors.muted }]}>{book.author}</Text>
            )}
            <Text style={[styles.meta, { color: colors.muted }]}>
              {(book.format || "book").toUpperCase()} · {titles.length} chapters
            </Text>
          </View>
        </View>

        {/* Primary actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={() => read()}
            style={[styles.primaryBtn, { backgroundColor: colors.text }]}>
            <Ionicons name="book" size={18} color={colors.background} />
            <Text style={[styles.primaryText, { color: colors.background }]}>
              {hasProgress ? `Continue · Ch. ${resumeChapter + 1}` : "Start reading"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.navigate({ pathname: "/search", params: { bookId: book.id } })}
            style={[styles.iconBtn, { borderColor: colors.muted }]}>
            <Ionicons name="search" size={20} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => router.navigate("/bookmarks")}
            style={[styles.iconBtn, { borderColor: colors.muted }]}>
            <Ionicons name="bookmark-outline" size={20} color={colors.text} />
          </Pressable>
        </View>

        {/* Tags (placeholder until AI) */}
        <Section title="Tags" colors={colors}>
          {book.tags.length ? (
            <View style={styles.tagRow}>
              {book.tags.map((t) => (
                <View key={t} style={[styles.tag, { borderColor: colors.muted }]}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{t}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Placeholder text="No tags yet — AI tagging arrives in a later phase." colors={colors} />
          )}
        </Section>

        <Section title="Story summary" colors={colors}>
          <Placeholder text="No summary yet — AI summary will appear here." colors={colors} />
        </Section>

        <Section title="Power system" colors={colors}>
          <Placeholder text="No power system extracted yet." colors={colors} />
        </Section>

        <Section title="Character profiles" colors={colors}>
          <Placeholder text="No characters extracted yet." colors={colors} />
        </Section>

        {/* Chapter index (real) */}
        <Section title={`Chapters (${titles.length})`} colors={colors}>
          {titles.map((t, i) => (
            <Pressable
              key={i}
              onPress={() => read(i)}
              style={[styles.chapterRow, { borderBottomColor: colors.muted }]}>
              <Text style={[styles.chapterNum, { color: colors.muted }]}>{i + 1}</Text>
              <Text style={[styles.chapterTitle, { color: colors.text }]} numberOfLines={2}>
                {t}
              </Text>
              {i === resumeChapter && hasProgress && (
                <Ionicons name="bookmark" size={14} color={colors.muted} />
              )}
            </Pressable>
          ))}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  colors,
  children,
}: {
  title: string;
  colors: { text: string; muted: string };
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {children}
    </View>
  );
}

function Placeholder({ text, colors }: { text: string; colors: { muted: string } }) {
  return <Text style={[styles.placeholder, { color: colors.muted }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  topBar: { paddingHorizontal: 16, paddingBottom: 4 },
  content: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: "row", gap: 16 },
  cover: { width: 110, aspectRatio: 2 / 3, borderRadius: 8, overflow: "hidden" },
  coverImg: { width: "100%", height: "100%" },
  coverFallback: { flex: 1, padding: 8, justifyContent: "center" },
  coverFallbackText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  headerInfo: { flex: 1, justifyContent: "center", gap: 4 },
  title: { fontSize: 22, fontWeight: "700" },
  author: { fontSize: 15 },
  meta: { fontSize: 12, marginTop: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 20 },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 24,
    paddingVertical: 12,
  },
  primaryText: { fontSize: 16, fontWeight: "700" },
  iconBtn: { borderWidth: 1, borderRadius: 22, padding: 11 },
  section: { marginTop: 28 },
  sectionTitle: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  placeholder: { fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chapterNum: { fontSize: 13, minWidth: 24, textAlign: "right" },
  chapterTitle: { flex: 1, fontSize: 15 },
});
