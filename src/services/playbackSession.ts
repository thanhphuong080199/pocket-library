/**
 * Screen-independent read-aloud session.
 *
 * The reader screen used to own the "speak this chapter, auto-advance to the
 * next" logic, which meant read-aloud only made sense while the reader was
 * mounted. Background playback + lock-screen "next/previous" need that logic to
 * live outside any screen, so it lives here: a tiny orchestrator over the book
 * store (what's open), the settings store (voice/rate/pitch) and the TTS engine.
 *
 * It reads chapter text straight from `bookStore` (the reader also renders from
 * there) and splits paragraphs with the shared `splitParagraphs`, so the segment
 * indices TTS reports line up with the on-screen paragraphs.
 */
import { useAudioStore } from "@/src/store/audioStore";
import { useBookStore } from "@/src/store/bookStore";
import { useSettingsStore } from "@/src/store/settingsStore";
import { splitParagraphs } from "@/src/utils/text";

import * as tts from "./tts";

/** Human title for a chapter, falling back to "Chương N" when the book has none. */
function chapterTitle(index: number): string {
  const titles = useBookStore.getState().currentBook?.chapterTitles ?? [];
  return titles[index]?.trim() || `Chương ${index + 1}`;
}

/** Push now-playing info into the store so the player bar + lock-screen render it. */
function publishNowPlaying(index: number): void {
  const book = useBookStore.getState().currentBook;
  const total = useBookStore.getState().chapters.length;
  useAudioStore.getState().setNowPlaying({
    bookTitle: book?.title ?? "",
    chapterTitle: chapterTitle(index),
    chapterIndex: index,
    totalChapters: total,
  });
}

/**
 * Read chapter `index` aloud from paragraph `startPara`, auto-advancing to the
 * next chapter when it finishes. Safe to call from any screen (or none).
 */
export function startChapter(index: number, startPara = 0): void {
  const { chapters, currentChapter, setChapter } = useBookStore.getState();
  const segments = splitParagraphs(chapters[index] ?? "");
  if (segments.length === 0) return;

  if (index !== currentChapter) setChapter(index);
  publishNowPlaying(index);

  const { ttsRate, ttsPitch, ttsVoice } = useSettingsStore.getState();
  tts.speak(
    segments,
    startPara,
    { rate: ttsRate, pitch: ttsPitch, voice: ttsVoice },
    {
      onDone: () => {
        const next = index + 1;
        if (next < useBookStore.getState().chapters.length) startChapter(next, 0);
      },
    },
  );
}

/** Advance read-aloud to the next chapter (lock-screen "next"). No-op at the end. */
export function nextChapter(): void {
  const { currentChapter, chapters } = useBookStore.getState();
  if (currentChapter + 1 < chapters.length) startChapter(currentChapter + 1, 0);
}

/** Rewind read-aloud to the previous chapter (lock-screen "previous"). */
export function prevChapter(): void {
  const { currentChapter } = useBookStore.getState();
  if (currentChapter - 1 >= 0) startChapter(currentChapter - 1, 0);
}

// Let the lock-screen / notification next-prev buttons change chapter (the native
// service emits a remote command; JS owns chapter navigation).
tts.setRemoteChapterHandler({ next: nextChapter, prev: prevChapter });

/**
 * Play/pause/resume the current read-aloud. Starts the current chapter if idle.
 * Shared by the reader's play button and the app-wide player bar / lock screen.
 */
export function togglePlayback(): void {
  const audio = useAudioStore.getState();
  if (audio.isPaused) {
    tts.resume();
  } else if (audio.isSpeaking) {
    tts.pause();
  } else {
    void tts.ensureVietnameseTTS();
    startChapter(useBookStore.getState().currentChapter);
  }
}
