import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { initDatabase } from '@/db/database';
import 'react-native-reanimated';

import { JournalProvider } from '@/hooks/JournalProvider';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  anchor: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [databaseReady, setDatabaseReady] = useState(false);
  const [databaseError, setDatabaseError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    initDatabase().then(() => {
      if (active) setDatabaseReady(true);
    }).catch((cause: unknown) => {
      if (active) setDatabaseError(cause instanceof Error ? cause : new Error(String(cause)));
    });
    return () => { active = false; };
  }, []);
  const [loaded, error] = useFonts({
    SpaceMono: require('../../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error || databaseError) {
      void SplashScreen.hideAsync();
      throw error || databaseError;
    }
  }, [error, databaseError]);

  useEffect(() => {
    if (loaded && databaseReady) {
      SplashScreen.hideAsync();
    }
  }, [loaded, databaseReady]);

  if (!loaded || !databaseReady) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0d1117', gap: 12 }}>
        <ActivityIndicator color="#58a6ff" size="large" />
        <Text accessibilityLiveRegion="polite" style={{ color: '#f0f6fc' }}>Loading TradeTrack…</Text>
      </View>
    );
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  return (
    <ThemeProvider value={DarkTheme}>
      <JournalProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: '#161b22' }, headerTintColor: '#f0f6fc', contentStyle: { backgroundColor: '#0d1117' } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="session/[id]" options={{ title: 'Personal session' }} />
      </Stack>
      </JournalProvider>
    </ThemeProvider>
  );
}
