import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { addBookmark, updateBookPosition } from "@/src/services/db";
import { useBookStore } from "@/src/store/bookStore";
import { FONT_FAMILIES, THEMES, useSettingsStore } from "@/src/store/settingsStore";

/** Split chapter text into paragraphs (blank-line separated; fall back to single newlines). */
function splitParagraphs(text: string): string[] {
  if (!text) return [];
  let parts = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) parts = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
  return parts.length ? parts : [text];
}

export default function ReaderScreen() {
  const router = useRouter();
  const theme = useSettingsStore((s) => s.theme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const colors = THEMES[theme];

  const book = useBookStore((s) => s.currentBook);
  const chapters = useBookStore((s) => s.chapters);
  const currentChapter = useBookStore((s) => s.currentChapter);
  const pendingScrollY = useBookStore((s) => s.pendingScrollY);
  const pendingParagraph = useBookStore((s) => s.pendingParagraph);
  const setChapter = useBookStore((s) => s.setChapter);
  const setPendingScrollY = useBookStore((s) => s.setPendingScrollY);
  const setPendingParagraph = useBookStore((s) => s.setPendingParagraph);

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  // Measured top offset of each paragraph in the current chapter.
  const paraOffsets = useRef<number[]>([]);
  // Paragraph we still need to scroll to once it has laid out.
  const pendingParaRef = useRef<number | null>(null);

  const paragraphs = useMemo(
    () => splitParagraphs(chapters[currentChapter] ?? ""),
    [chapters, currentChapter],
  );

  const persist = useCallback(() => {
    const b = useBookStore.getState().currentBook;
    if (!b) return;
    updateBookPosition(b.id, {
      chapterIndex: useBookStore.getState().currentChapter,
      scrollY: scrollY.current,
    });
  }, []);

  // Persist position when leaving the screen (tab blur or unmount).
  useFocusEffect(useCallback(() => () => persist(), [persist]));

  const goToChapter = useCallback(
    (index: number) => {
      if (index < 0 || index >= chapters.length) return;
      persist();
      scrollY.current = 0;
      setChapter(index);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    },
    [chapters.length, persist, setChapter],
  );

  // New chapter → forget the previous chapter's paragraph offsets.
  useEffect(() => {
    paraOffsets.current = [];
  }, [currentChapter]);

  // Consume a pending pixel scroll (resume / search / chapter list).
  useEffect(() => {
    if (pendingScrollY == null) return;
    const y = pendingScrollY;
    const id = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: false });
      scrollY.current = y;
      setPendingScrollY(null);
    });
    return () => cancelAnimationFrame(id);
  }, [pendingScrollY, currentChapter, setPendingScrollY]);

  // Consume a pending paragraph jump (bookmark). If the paragraph is already
  // measured, scroll now; otherwise onParaLayout will do it when it lays out.
  useEffect(() => {
    if (pendingParagraph == null) return;
    const target = pendingParagraph;
    setPendingParagraph(null);
    pendingParaRef.current = target;
    const y = paraOffsets.current[target];
    if (y != null) {
      pendingParaRef.current = null;
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y, animated: false });
        scrollY.current = y;
      });
    }
  }, [pendingParagraph, currentChapter, setPendingParagraph]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };

  const onParaLayout = (index: number, y: number) => {
    paraOffsets.current[index] = y;
    if (pendingParaRef.current === index) {
      pendingParaRef.current = null;
      scrollRef.current?.scrollTo({ y, animated: false });
      scrollY.current = y;
    }
  };

  // Index of the topmost paragraph at the current scroll position.
  const topParagraph = useCallback(() => {
    const offs = paraOffsets.current;
    let idx = 0;
    for (let i = 0; i < offs.length; i++) {
      if (offs[i] == null) continue;
      if (offs[i] <= scrollY.current + 8) idx = i;
      else break;
    }
    return idx;
  }, []);

  const bookmarkParagraph = useCallback(
    (index: number) => {
      if (!book) return;
      const excerpt = (paragraphs[index] ?? "").replace(/\s+/g, " ").slice(0, 160).trim();
      addBookmark({
        bookId: book.id,
        chapterIndex: currentChapter,
        paragraphIndex: index,
        scrollY: paraOffsets.current[index] ?? scrollY.current,
        highlight: excerpt,
      });
      Alert.alert(
        "Bookmarked",
        excerpt ? `“${excerpt.slice(0, 80)}${excerpt.length > 80 ? "…" : ""}”` : `Chapter ${currentChapter + 1}`,
      );
    },
    [book, currentChapter, paragraphs],
  );

  if (!book) {
    return (
      <SafeAreaView style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Ionicons name="book-outline" size={48} color={colors.muted} />
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          Open a book from your library to start reading.
        </Text>
      </SafeAreaView>
    );
  }

  const resolvedFont =
    FONT_FAMILIES.includes(fontFamily) && fontFamily !== "System" ? fontFamily : undefined;
  const total = chapters.length;
  const paraStyle = {
    color: colors.text,
    fontSize,
    lineHeight: fontSize * lineHeight,
    fontFamily: resolvedFont,
    marginBottom: fontSize * 0.9,
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.bar, { borderBottomColor: colors.muted }]}>
        <Text style={[styles.barTitle, { color: colors.text }]} numberOfLines={1}>
          {book.title}
        </Text>
        <View style={styles.barActions}>
          <Pressable onPress={() => router.navigate("/chapters")} hitSlop={10}>
            <Ionicons name="list" size={24} color={colors.text} />
          </Pressable>
          <Pressable onPress={() => bookmarkParagraph(topParagraph())} hitSlop={10}>
            <Ionicons name="bookmark-outline" size={22} color={colors.text} />
          </Pressable>
          <Pressable onPress={() => router.navigate("/bookmarks")} hitSlop={10}>
            <Ionicons name="bookmarks" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={100}>
        {paragraphs.map((p, i) => (
          <Pressable
            key={i}
            onLongPress={() => bookmarkParagraph(i)}
            delayLongPress={350}
            onLayout={(e) => onParaLayout(i, e.nativeEvent.layout.y)}>
            <Text style={paraStyle}>{p}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={[styles.nav, { borderTopColor: colors.muted }]}>
        <Pressable
          onPress={() => goToChapter(currentChapter - 1)}
          disabled={currentChapter <= 0}
          hitSlop={10}
          style={{ opacity: currentChapter <= 0 ? 0.3 : 1 }}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <Text style={[styles.navText, { color: colors.muted }]}>
          Chapter {currentChapter + 1} / {total}
        </Text>
        <Pressable
          onPress={() => goToChapter(currentChapter + 1)}
          disabled={currentChapter >= total - 1}
          hitSlop={10}
          style={{ opacity: currentChapter >= total - 1 ? 0.3 : 1 }}>
          <Ionicons name="chevron-forward" size={26} color={colors.text} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
  emptyText: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barTitle: { flex: 1, fontSize: 16, fontWeight: "600" },
  barActions: { flexDirection: "row", alignItems: "center", gap: 18 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 48 },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navText: { fontSize: 13, fontWeight: "500" },
});
