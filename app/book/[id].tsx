import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CharacterCard, PowerStageRow } from "@/src/components/CharacterProfile";
import { useBookAI, type AIFeature } from "@/src/hooks/useBookAI";
import { useSeriesKB } from "@/src/hooks/useSeriesKB";
import { generateCoverUrl } from "@/src/services/imageAI";
import { cancelAnalysis } from "@/src/services/kbRunner";
import {
  getBook,
  getBookVolume,
  getChapters,
  getSeries,
  getSeriesIdForBook,
  updateBookCover,
} from "@/src/services/db";
import { TAG_LABELS_VI } from "@/src/services/gemini";
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
  const chapters = useMemo(() => (book ? getChapters(book.id) : []), [book]);
  const ai = useBookAI(book, chapters);
  const kb = useSeriesKB(book);

  // AI cover for books that imported without one (Pollinations, free). The
  // generated URL is persisted, so this is a one-time manual action per book.
  const [aiCover, setAiCover] = useState<string | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const makeCover = async () => {
    if (!book || coverBusy) return;
    setCoverBusy(true);
    try {
      const url = await generateCoverUrl(book);
      updateBookCover(book.id, url);
      setAiCover(url);
    } finally {
      setCoverBusy(false);
    }
  };

  // Series membership (for the "view series" link on multi-volume series).
  const seriesInfo = useMemo(() => {
    if (!book) return null;
    const seriesId = getSeriesIdForBook(book.id);
    if (!seriesId) return null;
    const series = getSeries(seriesId);
    if (!series || series.totalVolumesImported <= 1) return null;
    return { id: seriesId, name: series.name, volume: getBookVolume(book.id) };
  }, [book]);

  // Load this book into the reader context so Read / Search / Bookmarks work.
  useEffect(() => {
    if (!book) return;
    setCurrentBook(book);
    setChapters(chapters);
  }, [book, chapters, setCurrentBook, setChapters]);

  if (!book) {
    return (
      <SafeAreaView style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.muted }}>Không tìm thấy sách.</Text>
      </SafeAreaView>
    );
  }

  const titles = book.chapterTitles?.length
    ? book.chapterTitles
    : Array.from({ length: book.totalChapters ?? 0 }, (_, i) => `Chương ${i + 1}`);
  const resumeChapter = book.lastPosition?.chapterIndex ?? 0;
  const hasProgress = resumeChapter > 0 || (book.lastPosition?.scrollY ?? 0) > 0;
  const kbRunning = kb.status === "running";
  const kbPaused = kb.status === "paused" || kb.canResume;
  const kbHasData = kb.kb.powerStages.length > 0 || kb.kb.characters.length > 0;

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
            {aiCover || book.coverUrl ? (
              <Image
                source={{ uri: aiCover ?? book.coverUrl }}
                style={styles.coverImg}
                contentFit="cover"
                transition={200}
              />
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
              {(book.format || "book").toUpperCase()} · {titles.length} chương
            </Text>
            {!book.coverUrl && !aiCover && (
              <Pressable
                onPress={makeCover}
                disabled={coverBusy}
                style={[styles.coverBtn, { borderColor: colors.muted, opacity: coverBusy ? 0.6 : 1 }]}>
                {coverBusy ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Ionicons name="color-palette-outline" size={15} color={colors.text} />
                )}
                <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                  Tạo bìa AI
                </Text>
              </Pressable>
            )}
            {seriesInfo && (
              <Pressable
                onPress={() =>
                  router.navigate({ pathname: "/series/[id]", params: { id: seriesInfo.id } })
                }
                style={styles.seriesLink}
                hitSlop={6}>
                <Ionicons name="albums-outline" size={14} color={colors.text} />
                <Text style={[styles.seriesLinkText, { color: colors.text }]} numberOfLines={1}>
                  {seriesInfo.name} · Tập {seriesInfo.volume}
                </Text>
                <Ionicons name="chevron-forward" size={13} color={colors.muted} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Primary actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={() => read()}
            style={[styles.primaryBtn, { backgroundColor: colors.text }]}>
            <Ionicons name="book" size={18} color={colors.background} />
            <Text style={[styles.primaryText, { color: colors.background }]}>
              {hasProgress ? `Đọc tiếp · Chương ${resumeChapter + 1}` : "Bắt đầu đọc"}
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

        {/* Tags (AI auto-tagging) */}
        <AISection
          title="Thể loại"
          feature={ai.tags}
          colors={colors}
          isEmpty={(t) => t.length === 0}
          emptyHint="Chưa có thể loại — phân tích để tự gắn thể loại & tâm trạng (đồng thời chọn nhạc nền)."
          noun="thể loại">
          {(tags) => (
            <View style={styles.tagRow}>
              {tags.map((t) => (
                <View key={t} style={[styles.tag, { borderColor: colors.muted }]}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{TAG_LABELS_VI[t] ?? t}</Text>
                </View>
              ))}
            </View>
          )}
        </AISection>

        <AISection
          title="Tóm tắt truyện"
          feature={ai.summary}
          colors={colors}
          isEmpty={(s) => s.trim().length === 0}
          emptyHint="Chưa có tóm tắt — phân tích cốt truyện đến hiện tại."
          noun="tóm tắt"
          collapsible
          initialCollapsed>
          {(text) => <Text style={[styles.bodyText, { color: colors.text }]}>{text}</Text>}
        </AISection>

        {/* Whole-book analysis → knowledge base (power system + characters + lore) */}
        <Section title="Phân tích truyện" colors={colors}>
          <Text style={[styles.placeholder, { color: colors.muted }]}>
            Đọc toàn bộ truyện để trích xuất hệ thống sức mạnh và hồ sơ nhân vật chi tiết. Chạy nền —
            bạn vẫn có thể đọc tiếp — và được lưu cache sau lần chạy đầu.
          </Text>

          {kbRunning ? (
            <View style={styles.kbRow}>
              <ActivityIndicator size="small" color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 }}>
                {kb.progress
                  ? `Đang phân tích… phần ${kb.progress.current + 1}/${kb.progress.total}`
                  : "Đang phân tích…"}
              </Text>
              <Pressable onPress={cancelAnalysis} hitSlop={8}>
                <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>Huỷ</Text>
              </Pressable>
            </View>
          ) : kbPaused ? (
            <Pressable
              onPress={kb.resume}
              style={[styles.aiBtn, styles.aiBtnInline, { borderColor: colors.muted }]}>
              <Ionicons name="play" size={16} color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                Tiếp tục phân tích
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={kbHasData ? kb.reanalyze : kb.analyze}
              style={[styles.aiBtn, styles.aiBtnInline, { borderColor: colors.muted }]}>
              <Ionicons name="sparkles-outline" size={16} color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                {kbHasData ? "Phân tích lại toàn bộ" : "Phân tích toàn bộ truyện"}
              </Text>
            </Pressable>
          )}

          {(kb.status === "error" || (kbPaused && kb.error)) && (
            <Text
              style={[styles.aiError, { color: kb.status === "error" ? "#c0392b" : colors.muted }]}>
              {kb.error}
            </Text>
          )}
        </Section>

        <Section title="Hệ thống sức mạnh" colors={colors} collapsible initialCollapsed>
          {kb.kb.powerStages.length > 0 ? (
            <View style={{ gap: 10 }}>
              {kb.kb.powerStages.map((s) => (
                <PowerStageRow key={s.id} stage={s} colors={colors} />
              ))}
            </View>
          ) : (
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              Chưa trích xuất hệ thống sức mạnh — hãy chạy phân tích ở trên.
            </Text>
          )}
        </Section>

        <Section
          title={`Hồ sơ nhân vật${kb.kb.characters.length ? ` (${kb.kb.characters.length})` : ""}`}
          colors={colors}
          collapsible
          initialCollapsed>
          {kb.kb.characters.length > 0 ? (
            <View style={{ gap: 12 }}>
              {kb.kb.characters.map((c) => (
                <CharacterCard
                  key={c.id}
                  character={c}
                  colors={colors}
                  onPress={() =>
                    router.navigate({ pathname: "/character/[id]", params: { id: c.id } })
                  }
                />
              ))}
            </View>
          ) : (
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              Chưa trích xuất nhân vật nào — hãy chạy phân tích ở trên.
            </Text>
          )}
        </Section>

        {/* Chapter index (real) */}
        <Section title={`Danh sách chương (${titles.length})`} colors={colors} collapsible initialCollapsed>
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

type SectionColors = { text: string; muted: string };

function Section({
  title,
  colors,
  children,
  collapsible = false,
  initialCollapsed = false,
}: {
  title: string;
  colors: SectionColors;
  children: React.ReactNode;
  /** Show a tappable header with a chevron that hides the body. */
  collapsible?: boolean;
  initialCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  if (!collapsible) {
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
        {children}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Pressable style={styles.sectionHeader} onPress={() => setCollapsed((c) => !c)} hitSlop={6}>
        <Text style={[styles.sectionTitle, { color: colors.text, marginBottom: 0 }]}>{title}</Text>
        <Ionicons name={collapsed ? "chevron-down" : "chevron-up"} size={18} color={colors.muted} />
      </Pressable>
      {!collapsed && <View style={{ marginTop: 12 }}>{children}</View>}
    </View>
  );
}

/**
 * A book-detail section backed by an AI feature: renders cached/loaded data,
 * a Generate/Re-generate button (manual — protects Gemini quota), and errors.
 * `noun` fills the button label ("Generate {noun} with AI").
 */
function AISection<T>({
  title,
  feature,
  colors,
  isEmpty,
  emptyHint,
  doneEmptyHint,
  noun,
  collapsible = false,
  initialCollapsed = false,
  children,
}: {
  title: string;
  feature: AIFeature<T>;
  colors: SectionColors;
  isEmpty: (data: T) => boolean;
  emptyHint: string;
  /** Shown when analysis finished but produced nothing (e.g. "no power system"). */
  doneEmptyHint?: string;
  noun: string;
  collapsible?: boolean;
  initialCollapsed?: boolean;
  children: (data: T) => React.ReactNode;
}) {
  const { data, status, error } = feature;
  const loading = status === "loading";
  const has = !isEmpty(data);

  return (
    <Section title={title} colors={colors} collapsible={collapsible} initialCollapsed={initialCollapsed}>
      {has ? (
        children(data)
      ) : (
        <Text style={[styles.placeholder, { color: colors.muted }]}>
          {status === "done" ? (doneEmptyHint ?? emptyHint) : emptyHint}
        </Text>
      )}

      <Pressable
        onPress={has ? feature.regenerate : feature.generate}
        disabled={loading}
        style={[
          styles.aiBtn,
          styles.aiBtnInline,
          { borderColor: colors.muted, opacity: loading ? 0.6 : 1 },
        ]}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Ionicons name="sparkles-outline" size={16} color={colors.text} />
        )}
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
          {loading ? "Đang phân tích…" : has ? `Tạo lại ${noun}` : `Tạo ${noun} bằng AI`}
        </Text>
      </Pressable>

      {status === "error" && <Text style={[styles.aiError, { color: "#c0392b" }]}>{error}</Text>}
    </Section>
  );
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
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  placeholder: { fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  bodyText: { fontSize: 15, lineHeight: 23 },
  seriesLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 6,
  },
  coverBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 8,
  },
  seriesLinkText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  aiBtnInline: { marginTop: 12 },
  kbRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  aiError: { fontSize: 13, marginTop: 8 },
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
