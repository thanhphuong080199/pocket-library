/**
 * KB location card: AI scenery illustration (Pollinations, free — see
 * imageAI.ts) over the extracted description. Used by the book detail page's
 * "Địa danh & bối cảnh" section.
 */
import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { Field, type KBColors } from "@/src/components/CharacterProfile";
import { locationImageUrl } from "@/src/services/imageAI";
import type { Location } from "@/src/services/db";

export function LocationCard({
  location,
  colors,
  genreTag,
}: {
  location: Location;
  colors: KBColors;
  /** Book tag driving the illustration style (see styleMap.ts). */
  genreTag?: string;
}) {
  const l = location;
  return (
    <View style={[styles.card, { borderColor: colors.muted }]}>
      <Image
        source={{ uri: locationImageUrl(l, genreTag) }}
        style={styles.image}
        contentFit="cover"
        transition={200}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={[styles.name, { color: colors.text }]}>{l.name}</Text>
          {!!l.type && (
            <View style={[styles.typeChip, { borderColor: colors.muted }]}>
              <Text style={{ color: colors.muted, fontSize: 11 }}>{l.type}</Text>
            </View>
          )}
        </View>
        {!!l.description && (
          <Text style={[styles.line, { color: colors.text }]}>{l.description}</Text>
        )}
        <Field label="Ý nghĩa" value={l.significance} colors={colors} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  image: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#00000022" },
  body: { padding: 12, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { fontSize: 16, fontWeight: "700", flexShrink: 1 },
  typeChip: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  line: { fontSize: 13, lineHeight: 19 },
});
