import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useBookAI, type AIFeature } from "@/src/hooks/useBookAI";
import { useSeriesKB } from "@/src/hooks/useSeriesKB";
import { cancelAnalysis } from "@/src/services/kbRunner";
import { getBook, getChapters, type Character, type PowerStage } from "@/src/services/db";
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

  // Load this book into the reader context so Read / Search / Bookmarks work.
  useEffect(() => {
    if (!book) return;
    setCurrentBook(book);
    setChapters(chapters);
  }, [book, chapters, setCurrentBook, setChapters]);

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

        {/* Tags (AI auto-tagging) */}
        <AISection
          title="Tags"
          feature={ai.tags}
          colors={colors}
          isEmpty={(t) => t.length === 0}
          emptyHint="No tags yet — analyze to auto-tag genre & mood (also picks background music)."
          noun="tags">
          {(tags) => (
            <View style={styles.tagRow}>
              {tags.map((t) => (
                <View key={t} style={[styles.tag, { borderColor: colors.muted }]}>
                  <Text style={{ color: colors.text, fontSize: 13 }}>{t}</Text>
                </View>
              ))}
            </View>
          )}
        </AISection>

        <AISection
          title="Story summary"
          feature={ai.summary}
          colors={colors}
          isEmpty={(s) => s.trim().length === 0}
          emptyHint="No summary yet — analyze the story so far."
          noun="summary"
          collapsible
          initialCollapsed>
          {(text) => <Text style={[styles.bodyText, { color: colors.text }]}>{text}</Text>}
        </AISection>

        {/* Whole-book analysis → knowledge base (power system + characters + lore) */}
        <Section title="Story analysis" colors={colors}>
          <Text style={[styles.placeholder, { color: colors.muted }]}>
            Reads the entire book to extract a detailed power system and character profiles. Runs in
            the background — you can keep reading — and is cached after the first run.
          </Text>

          {kbRunning ? (
            <View style={styles.kbRow}>
              <ActivityIndicator size="small" color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600", flex: 1 }}>
                {kb.progress
                  ? `Analyzing… chunk ${kb.progress.current + 1}/${kb.progress.total}`
                  : "Analyzing…"}
              </Text>
              <Pressable onPress={cancelAnalysis} hitSlop={8}>
                <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>Cancel</Text>
              </Pressable>
            </View>
          ) : kbPaused ? (
            <Pressable
              onPress={kb.resume}
              style={[styles.aiBtn, styles.aiBtnInline, { borderColor: colors.muted }]}>
              <Ionicons name="play" size={16} color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                Resume analysis
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={kbHasData ? kb.reanalyze : kb.analyze}
              style={[styles.aiBtn, styles.aiBtnInline, { borderColor: colors.muted }]}>
              <Ionicons name="sparkles-outline" size={16} color={colors.text} />
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                {kbHasData ? "Re-analyze full book" : "Analyze full book"}
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

        <Section title="Power system" colors={colors} collapsible initialCollapsed>
          {kb.kb.powerStages.length > 0 ? (
            <View style={{ gap: 10 }}>
              {kb.kb.powerStages.map((s) => (
                <PowerStageRow key={s.id} stage={s} colors={colors} />
              ))}
            </View>
          ) : (
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              No power system extracted yet — run the analysis above.
            </Text>
          )}
        </Section>

        <Section
          title={`Character profiles${kb.kb.characters.length ? ` (${kb.kb.characters.length})` : ""}`}
          colors={colors}
          collapsible
          initialCollapsed>
          {kb.kb.characters.length > 0 ? (
            <View style={{ gap: 12 }}>
              {kb.kb.characters.map((c) => (
                <CharacterCard key={c.id} character={c} colors={colors} />
              ))}
            </View>
          ) : (
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              No characters extracted yet — run the analysis above.
            </Text>
          )}
        </Section>

        {/* Chapter index (real) */}
        <Section title={`Chapters (${titles.length})`} colors={colors} collapsible initialCollapsed>
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
          {loading ? "Analyzing…" : has ? `Re-generate ${noun}` : `Generate ${noun} with AI`}
        </Text>
      </Pressable>

      {status === "error" && <Text style={[styles.aiError, { color: "#c0392b" }]}>{error}</Text>}
    </Section>
  );
}

function PowerStageRow({ stage, colors }: { stage: PowerStage; colors: SectionColors }) {
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
function CharacterCard({ character, colors }: { character: Character; colors: SectionColors }) {
  const c = character;
  const rels = c.relationships.map((r) => `${r.name} (${r.relation})`).join(", ");
  return (
    <View style={[styles.charCard, { borderColor: colors.muted }]}>
      <Text style={[styles.charName, { color: colors.text }]}>{c.name}</Text>
      <Field label="Giới tính" value={c.gender} colors={colors} />
      <Field label="Vai trò" value={c.role} colors={colors} />
      <Field label="Sức mạnh" value={c.currentPower} colors={colors} />
      <Field label="Thế lực" value={c.faction} colors={colors} />
      <Field label="Biệt danh" value={c.aliases.join(", ")} colors={colors} />
      <Field label="Kỹ năng" value={c.skills.join(", ")} colors={colors} />
      <Field label="Quan hệ" value={rels} colors={colors} />
      <Field label="Tính cách" value={c.personality} colors={colors} />
      <Field label="Trạng thái" value={c.status} colors={colors} />
      <Field label="Ngoại hình" value={c.appearance} colors={colors} />
      <Field label="Lai lịch" value={c.backstory} colors={colors} />
    </View>
  );
}

/** A labeled `Label: value` line; renders nothing when the value is empty. */
function Field({
  label,
  value,
  colors,
}: {
  label: string;
  value?: string;
  colors: SectionColors;
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
  charCard: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  charName: { fontSize: 16, fontWeight: "700", marginBottom: 2 },
  charLine: { fontSize: 13, lineHeight: 19 },
  psRow: { gap: 2 },
  psName: { fontSize: 15, fontWeight: "600" },
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
