import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { AudioPlayerBar } from '@/src/components/AudioPlayerBar';
import { KbProgressBanner } from '@/src/components/KbProgressBanner';
import { PdfExtractorHost } from '@/src/components/PdfExtractorHost';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { initDB } from '@/src/services/db';
import { hydrateInterrupted } from '@/src/services/kbRunner';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    initDB();
    // Surface any analysis left mid-flight last session as a resumable banner.
    hydrateInterrupted();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="book/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="series/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="character/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="characters" options={{ headerShown: false }} />
        <Stack.Screen name="chapters" options={{ headerShown: false }} />
        <Stack.Screen name="search" options={{ headerShown: false }} />
        <Stack.Screen name="bookmarks" options={{ headerShown: false }} />
      </Stack>
      <PdfExtractorHost />
      <AudioPlayerBar />
      <KbProgressBanner />
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
