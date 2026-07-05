/**
 * Character profile screen (Phase 5 Step B + Phase 6 art): accumulated current
 * state from the series knowledge base, an AI portrait (Pollinations, cached
 * forever in `characters.imageUrl`), the life-history timeline, and a stage
 * gallery — one portrait per `appearance_change` event (life stage /
 * transformation), all sharing the character's seed for face consistency.
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Field, LifeHistory, roleLabel } from "@/src/components/CharacterProfile";
import { pickStyleTag } from "@/src/constants/styleMap";
import {
  getBooksInSeries,
  getCharacter,
  getCharacterEvents,
  getSeries,
  updateCharacterEventImage,
  updateCharacterFullBody,
  updateCharacterImage,
  type CharacterEvent,
} from "@/src/services/db";
import {
  generateCharacterFullBodyUrl,
  generateCharacterPortraitUrl,
  generateStagePortraitUrl,
} from "@/src/services/imageAI";
import { THEMES, useSettingsStore } from "@/src/store/settingsStore";

export default function CharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = THEMES[useSettingsStore((s) => s.theme)];

  // refresh bumps re-read the DB after an image URL is persisted.
  const [refresh, setRefresh] = useState(0);
  const bump = useCallback(() => setRefresh((n) => n + 1), []);

  const character = useMemo(() => (id ? getCharacter(id) : null), [id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const events = useMemo(() => (id ? getCharacterEvents(id) : []), [id, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const seriesName = useMemo(
    () => (character ? getSeries(character.seriesId)?.name : undefined),
    [character],
  );
  // Art style follows the series' first volume's tags — a "Light Novel" (manga)
  // tag overrides wherever it sits; otherwise the first tag (STYLE_MAP).
  const styleTag = useMemo(
    () => (character ? pickStyleTag(getBooksInSeries(character.seriesId)[0]?.tags) : undefined),
    [character],
  );

  const [portraitBusy, setPortraitBusy] = useState(false);
  const [fullBodyBusy, setFullBodyBusy] = useState(false);
  const [stageBusy, setStageBusy] = useState<string | null>(null);

  const makePortrait = useCallback(async () => {
    if (!character || portraitBusy) return;
    setPortraitBusy(true);
    try {
      const url = await generateCharacterPortraitUrl(character, styleTag);
      updateCharacterImage(character.id, url);
      bump();
    } finally {
      setPortraitBusy(false);
    }
  }, [character, styleTag, portraitBusy, bump]);

  const makeFullBody = useCallback(async () => {
    if (!character || fullBodyBusy) return;
    setFullBodyBusy(true);
    try {
      const url = await generateCharacterFullBodyUrl(character, styleTag);
      updateCharacterFullBody(character.id, url);
      bump();
    } finally {
      setFullBodyBusy(false);
    }
  }, [character, styleTag, fullBodyBusy, bump]);

  const makeStagePortrait = useCallback(
    async (event: CharacterEvent) => {
      if (!character || stageBusy) return;
      setStageBusy(event.id);
      try {
        const url = await generateStagePortraitUrl(character, event, styleTag);
        updateCharacterEventImage(event.id, url);
        bump();
      } finally {
        setStageBusy(null);
      }
    },
    [character, styleTag, stageBusy, bump],
  );

  if (!character) {
    return (
      <SafeAreaView
        style={[styles.container, styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.muted }}>Không tìm thấy nhân vật.</Text>
      </SafeAreaView>
    );
  }

  const c = character;
  const rels = c.relationships.map((r) => `${r.name} (${r.relation})`).join(", ");
  const powerAndSkills = [c.currentPower, c.skills.join(", ")].filter(Boolean).join(" · ");
  const stages = events.filter(
    (e) => e.eventType === "appearance_change" && e.description.trim().length > 0,
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header: portrait + name */}
        <View style={styles.header}>
          <View style={[styles.portrait, { backgroundColor: colors.muted }]}>
            {c.imageUrl ? (
              <Image source={{ uri: c.imageUrl }} style={styles.portraitImg} contentFit="cover" transition={200} />
            ) : (
              <Ionicons name="person-outline" size={36} color="#fff" style={{ opacity: 0.7 }} />
            )}
          </View>
          <View style={styles.headerInfo}>
            <Text style={[styles.name, { color: colors.text }]}>{c.name}</Text>
            {!!seriesName && (
              <Text style={[styles.series, { color: colors.muted }]}>{seriesName}</Text>
            )}
            <Pressable
              onPress={makePortrait}
              disabled={portraitBusy}
              style={[styles.aiBtn, { borderColor: colors.muted, opacity: portraitBusy ? 0.6 : 1 }]}>
              {portraitBusy ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="color-palette-outline" size={15} color={colors.text} />
              )}
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                {c.imageUrl ? "Tạo lại chân dung" : "Tạo chân dung AI"}
              </Text>
            </Pressable>
            <Pressable
              onPress={makeFullBody}
              disabled={fullBodyBusy}
              style={[styles.aiBtn, { borderColor: colors.muted, opacity: fullBodyBusy ? 0.6 : 1 }]}>
              {fullBodyBusy ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Ionicons name="body-outline" size={15} color={colors.text} />
              )}
              <Text style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>
                {c.fullBodyUrl ? "Tạo lại toàn thân" : "Tạo ảnh toàn thân"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Profile fields */}
        <View style={[styles.card, { borderColor: colors.muted, marginTop: 16 }]}>
          <Field label="Giới tính" value={c.gender} colors={colors} />
          <Field label="Vai trò" value={roleLabel(c.role)} colors={colors} />
          <Field label="Sức mạnh & kỹ năng" value={powerAndSkills} colors={colors} />
          <Field label="Thế lực" value={c.faction} colors={colors} />
          <Field label="Biệt danh" value={c.aliases.join(", ")} colors={colors} />
          <Field label="Quan hệ" value={rels} colors={colors} />
          <Field label="Tính cách" value={c.personality} colors={colors} />
          <Field label="Trạng thái" value={c.status} colors={colors} />
          <Field label="Ngoại hình" value={c.appearance} colors={colors} />
          <Field label="Lai lịch" value={c.backstory} colors={colors} />
        </View>

        {/* Character illustrations — every generated image in one gallery, each
            captioned with what it depicts (portrait, full body, life stages).
            Stage cards without an image yet offer an inline generate button. */}
        {(c.imageUrl || c.fullBodyUrl || stages.length > 0) && (
          <View style={{ marginTop: 20 }}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Minh hoạ nhân vật</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.stageRow}>
                {c.imageUrl && (
                  <IllustrationCard uri={c.imageUrl} label="Chân dung" colors={colors} />
                )}
                {c.fullBodyUrl && (
                  <IllustrationCard uri={c.fullBodyUrl} label="Toàn thân" colors={colors} />
                )}
                {stages.map((e) => (
                  <IllustrationCard
                    key={e.id}
                    uri={e.imageUrl}
                    label={e.description}
                    sublabel={`${e.volume > 0 ? `Tập ${e.volume} · ` : ""}Chương ${e.chapter + 1}`}
                    colors={colors}
                    onGenerate={() => makeStagePortrait(e)}
                    busy={stageBusy === e.id}
                    disabled={stageBusy !== null}
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        )}

        {/* Life history timeline */}
        <View style={[styles.card, { borderColor: colors.muted, marginTop: 16 }]}>
          {events.some((e) => e.description.trim().length > 0) ? (
            <LifeHistory events={events} colors={colors} />
          ) : (
            <Text style={[styles.placeholder, { color: colors.muted }]}>
              Chưa có sự kiện nào được ghi nhận cho nhân vật này.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * One card in the "Minh hoạ nhân vật" gallery: an illustration with a caption
 * label under it saying what it depicts. When `uri` is missing but `onGenerate`
 * is given (stage images), the image slot becomes a tap-to-generate button.
 */
function IllustrationCard({
  uri,
  label,
  sublabel,
  colors,
  onGenerate,
  busy,
  disabled,
}: {
  uri?: string;
  label: string;
  sublabel?: string;
  colors: { text: string; muted: string };
  onGenerate?: () => void;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.stageCard, { borderColor: colors.muted }]}>
      <View style={[styles.stageImgWrap, { backgroundColor: colors.muted }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.portraitImg} contentFit="cover" transition={200} />
        ) : onGenerate ? (
          <Pressable onPress={onGenerate} disabled={disabled} style={styles.stageGenBtn}>
            {busy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="color-palette-outline" size={22} color="#fff" />
            )}
            <Text style={styles.stageGenText}>Tạo ảnh</Text>
          </Pressable>
        ) : null}
      </View>
      {!!sublabel && <Text style={[styles.stageMeta, { color: colors.muted }]}>{sublabel}</Text>}
      <Text style={[styles.stageDesc, { color: colors.text }]} numberOfLines={3}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
  topBar: { paddingHorizontal: 16, paddingBottom: 4 },
  content: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: "row", gap: 14 },
  portrait: {
    width: 96,
    aspectRatio: 2 / 3,
    borderRadius: 10,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  portraitImg: { width: "100%", height: "100%" },
  headerInfo: { flex: 1, justifyContent: "center", gap: 4 },
  name: { fontSize: 24, fontWeight: "700" },
  series: { fontSize: 14 },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 6,
  },
  card: { borderWidth: 1, borderRadius: 10, padding: 14, gap: 4 },
  placeholder: { fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  stageRow: { flexDirection: "row", gap: 12 },
  stageCard: { width: 130, borderWidth: 1, borderRadius: 10, padding: 8, gap: 4 },
  stageImgWrap: {
    width: "100%",
    aspectRatio: 2 / 3,
    borderRadius: 6,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  stageGenBtn: { alignItems: "center", justifyContent: "center", gap: 4, flex: 1, alignSelf: "stretch" },
  stageGenText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  stageMeta: { fontSize: 11 },
  stageDesc: { fontSize: 12, lineHeight: 16 },
});
