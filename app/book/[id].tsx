import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useBookAI, type AIFeature } from "@/src/hooks/useBookAI";
import { useSeriesKB } from "@/src/hooks/useSeriesKB";
import { cancelAnalysis } from "@/src/services/kbRunner";
import {
  getBook,
  getChapters,
  getCharacterEvents,
  type Character,
  type CharacterEvent,
  type PowerStage,
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
              {(book.format || "book").toUpperCase()} · {titles.length} chương
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
                <CharacterCard key={c.id} character={c} colors={colors} />
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

/** Vietnamese display labels for the model's English role values. */
const ROLE_LABELS_VI: Record<string, string> = {
  protagonist: "Nhân vật chính",
  antagonist: "Phản diện",
  supporting: "Nhân vật phụ",
};

/** Labeled character profile (Name / Gender / Power / …) from the series KB. */
function CharacterCard({ character, colors }: { character: Character; colors: SectionColors }) {
  const c = character;
  // Reload the life-history events whenever this character advances in the book.
  const events = useMemo(
    () => getCharacterEvents(c.id),
    [c.id, c.lastSeenVolume, c.lastSeenChapter],
  );

  // Relationships: "relation" is stored from THIS character's point of view — it
  // states what the named person is TO this character (see deltaExtractor prompt),
  // so "B (vợ)" on A's card means B is A's wife.
  const rels = c.relationships.map((r) => `${r.name} (${r.relation})`).join(", ");
  // Merge Strengths (current realm/power) and Skills into one field — they
  // overlap heavily in practice, so a single line reads cleaner.
  const powerAndSkills = [c.currentPower, c.skills.join(", ")].filter(Boolean).join(" · ");
  const role = c.role ? (ROLE_LABELS_VI[c.role.toLowerCase()] ?? c.role) : undefined;

  return (
    <View style={[styles.charCard, { borderColor: colors.muted }]}>
      <Text style={[styles.charName, { color: colors.text }]}>{c.name}</Text>
      <Field label="Giới tính" value={c.gender} colors={colors} />
      <Field label="Vai trò" value={role} colors={colors} />
      <Field label="Sức mạnh & kỹ năng" value={powerAndSkills} colors={colors} />
      <Field label="Thế lực" value={c.faction} colors={colors} />
      <Field label="Biệt danh" value={c.aliases.join(", ")} colors={colors} />
      <Field label="Quan hệ" value={rels} colors={colors} />
      <Field label="Tính cách" value={c.personality} colors={colors} />
      <Field label="Trạng thái" value={c.status} colors={colors} />
      <Field label="Ngoại hình" value={c.appearance} colors={colors} />
      <Field label="Lai lịch" value={c.backstory} colors={colors} />
      <LifeHistory events={events} colors={colors} />
    </View>
  );
}

/**
 * Character life history: the full append-only event log in chronological order
 * (getCharacterEvents already sorts by volume then chapter), not just the latest
 * overwritten backstory.
 */
function LifeHistory({ events, colors }: { events: CharacterEvent[]; colors: SectionColors }) {
  const visible = events.filter((e) => e.description.trim().length > 0);
  if (visible.length === 0) return null;
  return (
    <View style={styles.timeline}>
      <Text style={[styles.charLine, { color: colors.muted, fontWeight: "600" }]}>Tiểu sử:</Text>
      {visible.map((e) => (
        <Text key={e.id} style={[styles.timelineItem, { color: colors.text }]}>
          {"• "}
          {e.chapter > 0 && (
            <Text style={{ color: colors.muted }}>{`Chương ${e.chapter + 1}: `}</Text>
          )}
          {e.description}
        </Text>
      ))}
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
  timeline: { marginTop: 4, gap: 3 },
  timelineItem: { fontSize: 13, lineHeight: 19, paddingLeft: 4 },
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
