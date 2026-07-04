/**
 * Series view (Phase 5 Step B): the full accumulated knowledge base of a
 * series across volumes — volume list, power ladder, character roster
 * (tap → character profile), and world lore.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PowerStageRow, roleLabel } from "@/src/components/CharacterProfile";
import {
  getBooksInSeries,
  getBookVolume,
  getSeries,
  type Book,
  type Series,
} from "@/src/services/db";
import { getSeriesKB, type SeriesKB } from "@/src/services/knowledgeBase";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

const EMPTY_KB: SeriesKB = { powerStages: [], characters: [], lore: [], locations: [] };

export default function SeriesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = THEMES[useSettingsStore((s) => s.theme)];

  const [series, setSeries] = useState<Series | null>(null);
  const [books, setBooks] = useState<(Book & { volume: number })[]>([]);
  const [kb, setKb] = useState<SeriesKB>(EMPTY_KB);

  // Refresh on focus — a background analysis may have advanced the KB.
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setSeries(getSeries(id));
      setBooks(getBooksInSeries(id).map((b) => ({ ...b, volume: getBookVolume(b.id) })));
      setKb(getSeriesKB(id));
    }, [id]),
  );

  if (!series) {
    return (
      <SafeAreaView
        style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.muted }}>Không tìm thấy series.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: colors.text }]}>{series.name}</Text>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {books.length} tập đã nhập
        </Text>

        {/* Volumes */}
        <Section title="Các tập" colors={colors}>
          {books.map((b) => (
            <Pressable
              key={b.id}
              onPress={() => router.navigate({ pathname: "/book/[id]", params: { id: b.id } })}
              style={[styles.volumeRow, { borderBottomColor: colors.muted }]}>
              <View style={[styles.volCover, { backgroundColor: colors.muted }]}>
                {b.coverUrl ? (
                  <Image source={{ uri: b.coverUrl }} style={styles.volCoverImg} contentFit="cover" />
                ) : (
                  <Ionicons name="book-outline" size={18} color="#fff" style={styles.volCoverIcon} />
                )}
              </View>
              <View style={styles.volInfo}>
                <Text style={[styles.volTitle, { color: colors.text }]} numberOfLines={1}>
                  {b.title}
                </Text>
                <Text style={[styles.volMeta, { color: colors.muted }]}>Tập {b.volume}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          ))}
        </Section>

        {/* Power ladder */}
        <Section title="Hệ thống sức mạnh" colors={colors}>
          {kb.powerStages.length > 0 ? (
            <View style={{ gap: 10 }}>
              {kb.powerStages.map((s) => (
                <PowerStageRow key={s.id} stage={s} colors={colors} />
              ))}
            </View>
          ) : (
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              Chưa có dữ liệu — phân tích một tập từ trang chi tiết sách.
            </Text>
          )}
        </Section>

        {/* Character roster */}
        <Section
          title={`Nhân vật${kb.characters.length ? ` (${kb.characters.length})` : ""}`}
          colors={colors}>
          {kb.characters.length > 0 ? (
            kb.characters.map((c) => {
              const sub = [roleLabel(c.role), c.currentPower].filter(Boolean).join(" · ");
              return (
                <Pressable
                  key={c.id}
                  onPress={() =>
                    router.navigate({ pathname: "/character/[id]", params: { id: c.id } })
                  }
                  style={[styles.charRow, { borderBottomColor: colors.muted }]}>
                  <View style={styles.volInfo}>
                    <Text style={[styles.volTitle, { color: colors.text }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {!!sub && (
                      <Text style={[styles.volMeta, { color: colors.muted }]} numberOfLines={1}>
                        {sub}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                </Pressable>
              );
            })
          ) : (
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              Chưa có nhân vật nào được trích xuất.
            </Text>
          )}
        </Section>

        {/* World lore */}
        {kb.lore.length > 0 && (
          <Section title={`Thế giới quan (${kb.lore.length})`} colors={colors}>
            <View style={{ gap: 10 }}>
              {kb.lore.map((l) => (
                <View key={l.id}>
                  <Text style={[styles.loreTitle, { color: colors.text }]}>
                    {l.title || l.category}
                  </Text>
                  <Text style={[styles.loreBody, { color: colors.muted }]}>{l.content}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  topBar: { paddingHorizontal: 16, paddingBottom: 4 },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: "700" },
  meta: { fontSize: 13, marginTop: 2 },
  section: { marginTop: 26 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  placeholder: { fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  volumeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  volCover: {
    width: 34,
    height: 50,
    borderRadius: 4,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  volCoverImg: { width: "100%", height: "100%" },
  volCoverIcon: { opacity: 0.8 },
  volInfo: { flex: 1, gap: 2 },
  volTitle: { fontSize: 15, fontWeight: "600" },
  volMeta: { fontSize: 12 },
  charRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  loreTitle: { fontSize: 14, fontWeight: "600", marginBottom: 2 },
  loreBody: { fontSize: 13, lineHeight: 19 },
});
