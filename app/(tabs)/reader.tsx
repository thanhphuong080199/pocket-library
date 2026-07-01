import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutChangeEvent,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { GestureResponderEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { addBookmark, getAICache, setAICache, updateBookPosition } from "@/src/services/db";
import * as gemini from "@/src/services/gemini";
import * as music from "@/src/services/music";
import * as playback from "@/src/services/playbackSession";
import * as tts from "@/src/services/tts";
import { useAudioStore } from "@/src/store/audioStore";
import { useBookStore } from "@/src/store/bookStore";
import { FONT_FAMILIES, THEMES, useSettingsStore } from "@/src/store/settingsStore";
import { splitParagraphs } from "@/src/utils/text";

type Token = { text: string; word: string | null; wordIndex: number };

/**
 * Split a paragraph into tokens, keeping whitespace so it re-joins exactly.
 * Word tokens get a running `wordIndex` (used for tap-to-select range logic);
 * whitespace / pure-punctuation tokens get `word: null` and `wordIndex: -1`.
 */
function tokenize(text: string): Token[] {
  const raw = text.split(/(\s+)/);
  let wi = 0;
  return raw.map((t) => {
    if (!/[\p{L}\p{N}]/u.test(t)) return { text: t, word: null, wordIndex: -1 };
    const word = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!word) return { text: t, word: null, wordIndex: -1 };
    return { text: t, word, wordIndex: wi++ };
  });
}

/**
 * Reconstruct the exact phrase spanning word indices `a`..`b` (inclusive, order
 * independent) — including the original spacing/punctuation between them.
 */
function phraseFromSelection(text: string, a: number, b: number): string {
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  const toks = tokenize(text);
  const first = toks.findIndex((t) => t.wordIndex === start);
  let last = -1;
  for (let i = toks.length - 1; i >= 0; i--) {
    if (toks[i].wordIndex === end) {
      last = i;
      break;
    }
  }
  if (first < 0 || last < 0) return "";
  return toks
    .slice(first, last + 1)
    .map((t) => t.text)
    .join("")
    .trim();
}

export default function ReaderScreen() {
  const router = useRouter();
  const theme = useSettingsStore((s) => s.theme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const lineHeight = useSettingsStore((s) => s.lineHeight);
  const colors = THEMES[theme];

  const isSpeaking = useAudioStore((s) => s.isSpeaking);
  const isPaused = useAudioStore((s) => s.isPaused);
  const ttsSegment = useAudioStore((s) => s.ttsSegment);
  const ttsTotalSegments = useAudioStore((s) => s.ttsTotalSegments);
  const ttsActive = isSpeaking || isPaused;
  const isMusicPlaying = useAudioStore((s) => s.isMusicPlaying);
  const musicAvailable = music.isMusicAvailable();

  const book = useBookStore((s) => s.currentBook);
  const chapters = useBookStore((s) => s.chapters);
  const currentChapter = useBookStore((s) => s.currentChapter);
  const pendingScrollY = useBookStore((s) => s.pendingScrollY);
  const pendingParagraph = useBookStore((s) => s.pendingParagraph);
  const setChapter = useBookStore((s) => s.setChapter);
  const setPendingScrollY = useBookStore((s) => s.setPendingScrollY);
  const setPendingParagraph = useBookStore((s) => s.setPendingParagraph);

  // Word-explainer ("define") mode: select a phrase → AI explanation. Off by
  // default so normal reading/TTS/long-press-bookmark gestures are unchanged.
  // Tap the first word then the last word of a phrase to select a range (a
  // single tap selects one word); a floating bar then offers "Explain".
  const [defineMode, setDefineMode] = useState(false);
  const [selection, setSelection] = useState<{ para: number; start: number; end: number } | null>(
    null,
  );
  const [defineTarget, setDefineTarget] = useState<{ term: string; context: string } | null>(null);

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

  // Tap a word in define mode: first tap (or a tap in a new paragraph) sets the
  // anchor; subsequent taps in the same paragraph move the other end so the
  // range spans from the anchor to the tapped word.
  const onWordPress = useCallback((para: number, wordIndex: number) => {
    setSelection((prev) =>
      prev && prev.para === para
        ? { ...prev, end: wordIndex }
        : { para, start: wordIndex, end: wordIndex },
    );
  }, []);

  const selectedPhrase = useMemo(
    () =>
      selection ? phraseFromSelection(paragraphs[selection.para] ?? "", selection.start, selection.end) : "",
    [selection, paragraphs],
  );

  const explainSelection = useCallback(() => {
    if (!selection || !selectedPhrase) return;
    setDefineTarget({ term: selectedPhrase, context: paragraphs[selection.para] ?? "" });
  }, [selection, selectedPhrase, paragraphs]);

  // Clear any selection when leaving define mode or changing chapter.
  useEffect(() => {
    if (!defineMode) setSelection(null);
  }, [defineMode]);
  useEffect(() => {
    setSelection(null);
  }, [currentChapter]);

  const persist = useCallback(() => {
    const b = useBookStore.getState().currentBook;
    if (!b) return;
    updateBookPosition(b.id, {
      chapterIndex: useBookStore.getState().currentChapter,
      scrollY: scrollY.current,
    });
  }, []);

  // Persist position when leaving the screen. Audio is intentionally NOT stopped
  // here — read-aloud + music now play app-wide (background service) and are
  // controlled from the player bar / lock screen, surviving in-app navigation.
  useFocusEffect(
    useCallback(() => () => persist(), [persist]),
  );

  // Toggle background music on/off, choosing a loop from the book's AI tags
  // (falls back to a neutral default when the book has no tags yet).
  const toggleMusic = useCallback(() => {
    if (useAudioStore.getState().isMusicPlaying) {
      music.stopMusic();
    } else {
      void music.playForTags(useBookStore.getState().currentBook?.tags ?? []);
    }
  }, []);

  const goToChapter = useCallback(
    (index: number) => {
      if (index < 0 || index >= chapters.length) return;
      tts.stop(); // manual navigation cancels read-aloud
      persist();
      scrollY.current = 0;
      setChapter(index);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
    },
    [chapters.length, persist, setChapter],
  );

  // Read-aloud play/pause. Chapter orchestration + auto-advance live in the
  // screen-independent playback session so they keep running in the background.
  const toggleTts = useCallback(() => playback.togglePlayback(), []);

  // Jump read-aloud to a paragraph in the current chapter (progress-bar seek).
  const seekTts = useCallback(
    (para: number) => {
      const clamped = Math.max(0, Math.min(para, paragraphs.length - 1));
      playback.startChapter(currentChapter, clamped);
    },
    [paragraphs.length, currentChapter],
  );

  // Follow the paragraph being read: scroll it into view as TTS advances.
  useEffect(() => {
    if (!ttsActive || ttsSegment < 0) return;
    const y = paraOffsets.current[ttsSegment];
    if (y != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, y - 24), animated: true });
      scrollY.current = y;
    }
  }, [ttsSegment, ttsActive]);

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
  const isDarkTheme = theme === "dark" || theme === "black";
  const highlightBg = isDarkTheme ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.07)";
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
          <Pressable onPress={toggleTts} hitSlop={10}>
            <Ionicons
              name={isSpeaking && !isPaused ? "pause-circle" : "play-circle"}
              size={26}
              color={colors.text}
            />
          </Pressable>
          {(isSpeaking || isPaused) && (
            <Pressable onPress={() => tts.stop()} hitSlop={10}>
              <Ionicons name="stop-circle" size={26} color={colors.text} />
            </Pressable>
          )}
          {musicAvailable && (
            <Pressable onPress={toggleMusic} hitSlop={10}>
              <Ionicons
                name={isMusicPlaying ? "musical-notes" : "musical-notes-outline"}
                size={22}
                color={colors.text}
              />
            </Pressable>
          )}
          <Pressable onPress={() => setDefineMode((v) => !v)} hitSlop={10}>
            <Ionicons name="language" size={22} color={defineMode ? "#e67e22" : colors.text} />
          </Pressable>
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
        {defineMode && (
          <Text style={[styles.defineHint, { color: "#e67e22" }]}>
            Tap the first and last word of a phrase (or one word), then tap Explain.
          </Text>
        )}
        {paragraphs.map((p, i) => (
          <Pressable
            key={i}
            onLongPress={() => bookmarkParagraph(i)}
            delayLongPress={350}
            onLayout={(e) => onParaLayout(i, e.nativeEvent.layout.y)}
            style={i === ttsSegment ? { backgroundColor: highlightBg, borderRadius: 6 } : undefined}>
            <ParagraphBody
              text={p}
              style={paraStyle}
              defineMode={defineMode}
              selection={
                selection && selection.para === i
                  ? { start: Math.min(selection.start, selection.end), end: Math.max(selection.start, selection.end) }
                  : null
              }
              onWord={(wordIndex) => onWordPress(i, wordIndex)}
            />
          </Pressable>
        ))}
      </ScrollView>

      {defineMode && selection && selectedPhrase !== "" && (
        <View style={[styles.selectBar, { backgroundColor: colors.background, borderTopColor: colors.muted }]}>
          <Text style={[styles.selectPhrase, { color: colors.text }]} numberOfLines={1}>
            「{selectedPhrase}」
          </Text>
          <Pressable onPress={() => setSelection(null)} hitSlop={10}>
            <Ionicons name="close" size={20} color={colors.muted} />
          </Pressable>
          <Pressable onPress={explainSelection} style={styles.explainBtn} hitSlop={8}>
            <Ionicons name="sparkles-outline" size={16} color="#fff" />
            <Text style={styles.explainBtnText}>Explain</Text>
          </Pressable>
        </View>
      )}

      {defineTarget && book && (
        <WordExplainer
          term={defineTarget.term}
          context={defineTarget.context}
          bookId={book.id}
          colors={colors}
          onClose={() => setDefineTarget(null)}
        />
      )}

      {ttsActive && (
        <TtsProgress
          current={ttsSegment}
          total={ttsTotalSegments}
          colors={colors}
          onSeek={seekTts}
        />
      )}

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

/**
 * Seekable read-aloud progress bar (by paragraph). Tap or drag anywhere on the
 * track to jump TTS to that paragraph. Shows a live preview while dragging and
 * only commits the seek on release (restarting TTS mid-drag would be choppy).
 */
function TtsProgress({
  current,
  total,
  colors,
  onSeek,
}: {
  current: number;
  total: number;
  colors: { text: string; muted: string; background: string };
  onSeek: (para: number) => void;
}) {
  const widthRef = useRef(0);
  const [drag, setDrag] = useState<number | null>(null);

  const fracFromX = (x: number) => {
    const w = widthRef.current || 1;
    return Math.max(0, Math.min(1, x / w));
  };
  const frac = drag ?? (total > 0 ? (Math.max(0, current) + 1) / total : 0);
  const shownPara = drag != null && total > 0 ? Math.round(drag * (total - 1)) : Math.max(0, current);

  return (
    <View style={[styles.progressWrap, { borderTopColor: colors.muted }]}>
      <View
        style={styles.progressTouch}
        onLayout={(e: LayoutChangeEvent) => (widthRef.current = e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e: GestureResponderEvent) => setDrag(fracFromX(e.nativeEvent.locationX))}
        onResponderMove={(e: GestureResponderEvent) => setDrag(fracFromX(e.nativeEvent.locationX))}
        onResponderRelease={(e: GestureResponderEvent) => {
          const f = fracFromX(e.nativeEvent.locationX);
          setDrag(null);
          if (total > 0) onSeek(Math.round(f * (total - 1)));
        }}
        onResponderTerminate={() => setDrag(null)}>
        <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
          <View style={[styles.progressFill, { backgroundColor: colors.text, width: `${frac * 100}%` }]} />
        </View>
      </View>
      <Text style={[styles.progressLabel, { color: colors.muted }]}>
        ¶ {shownPara + 1} / {total || 1}
      </Text>
    </View>
  );
}

/**
 * Renders a paragraph. In normal mode it's a plain `<Text>`. In define mode
 * every word becomes a tappable nested `<Text>` (nested Text keeps the line
 * flow intact) that reports the tapped word's index to `onWord`. Words whose
 * index falls inside `selection` (inclusive range) are highlighted.
 */
function ParagraphBody({
  text,
  style,
  defineMode,
  selection,
  onWord,
}: {
  text: string;
  style: object;
  defineMode: boolean;
  selection: { start: number; end: number } | null;
  onWord: (wordIndex: number) => void;
}) {
  if (!defineMode) return <Text style={style}>{text}</Text>;

  const tokens = tokenize(text);
  return (
    <Text style={style}>
      {tokens.map((tok, i) => {
        if (tok.word == null) return tok.text; // whitespace / pure punctuation
        const selected =
          selection != null && tok.wordIndex >= selection.start && tok.wordIndex <= selection.end;
        return (
          <Text
            key={i}
            onPress={() => onWord(tok.wordIndex)}
            style={[styles.defineWord, selected && styles.defineWordSelected]}>
            {tok.text}
          </Text>
        );
      })}
    </Text>
  );
}

/**
 * Modal that explains a selected word or phrase in context via Gemini. Cached
 * per term (book-scoped) in `ai_cache` so re-selecting the same term costs no
 * quota.
 */
function WordExplainer({
  term,
  context,
  bookId,
  colors,
  onClose,
}: {
  term: string;
  context: string;
  bookId: string;
  colors: { text: string; muted: string; background: string };
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(null);

    if (!gemini.isGeminiConfigured()) {
      setError("Gemini API key not set (EXPO_PUBLIC_GEMINI_KEY).");
      return;
    }

    const cacheKey = `word_${term.toLowerCase()}`;
    const cached = getAICache(bookId, cacheKey);
    if (cached) {
      setText(cached);
      return;
    }

    (async () => {
      try {
        const result = await gemini.explainWord(term, context);
        if (!alive) return;
        setText(result);
        if (result) setAICache(bookId, cacheKey, result);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not explain this selection.");
      }
    })();

    return () => {
      alive = false;
    };
  }, [term, context, bookId]);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={[styles.modalCard, { backgroundColor: colors.background, borderColor: colors.muted }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalWord, { color: colors.text }]} numberOfLines={2}>
              {term}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          {error ? (
            <Text style={[styles.modalBody, { color: "#c0392b" }]}>{error}</Text>
          ) : text == null ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator color={colors.text} />
              <Text style={{ color: colors.muted }}>Explaining…</Text>
            </View>
          ) : (
            <Text style={[styles.modalBody, { color: colors.text }]}>{text}</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
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
  progressWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  progressTouch: { flex: 1, height: 28, justifyContent: "center" },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden", opacity: 0.5 },
  progressFill: { height: 4, borderRadius: 2 },
  progressLabel: { fontSize: 12, fontWeight: "500", minWidth: 56, textAlign: "right" },
  defineHint: { fontSize: 13, fontWeight: "600", marginBottom: 12 },
  defineWord: { textDecorationLine: "underline", textDecorationStyle: "dotted" },
  defineWordSelected: { backgroundColor: "rgba(230,126,34,0.3)" },
  selectBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  selectPhrase: { flex: 1, fontSize: 15, fontWeight: "600" },
  explainBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#e67e22",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  explainBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
  },
  modalCard: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 14, padding: 18, gap: 12 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  modalWord: { flex: 1, fontSize: 20, fontWeight: "700" },
  modalBody: { fontSize: 15, lineHeight: 22 },
  modalLoading: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
});
