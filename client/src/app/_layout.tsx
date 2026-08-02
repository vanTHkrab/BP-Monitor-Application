import '../global.css';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TamaguiProvider } from 'tamagui';

import tamaguiConfig from '../../tamagui.config';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useDatabaseMigrations } from '@/database/migrator';
import {
  initAuth,
  registerSessionExpiryHandler,
  registerSessionUserMirror,
} from '@/modules/auth';
import {
  initReminderNotifications,
  stopReminderNotifications,
} from '@/modules/notifications';
import { ReadingsSyncProvider, cleanupOrphanedPendingImages } from '@/modules/readings';
import { AppLockGate } from '@/modules/security';
import { createQueryClient } from '@/services/query-client';
import { usePreferencesStore } from '@/stores';
import { navigationThemeFor } from '@/theme';
import {
  ColorSchemeProvider,
  useColorSchemePreference,
} from '@/theme/color-scheme';

SplashScreen.preventAutoHideAsync();

/**
 * Restores the session and wires the transport's 401 fan-out, once.
 *
 * The handler is registered before `initAuth` runs so that a token rejected
 * during the restore itself still routes through the same sign-out path.
 */
function useAuthBootstrap() {
  useEffect(() => {
    const unregister = registerSessionExpiryHandler();
    // Mirrors the signed-in user id to device storage so an offline cold
    // start knows whose local readings to show — see `modules/auth/bootstrap`.
    const unsubscribe = registerSessionUserMirror();
    void initAuth();
    return () => {
      unregister();
      unsubscribe();
    };
  }, []);
}

/**
 * Listens for reminder notifications, once.
 *
 * Independent of auth on purpose: a reminder can be tapped while the session
 * is still being restored, and the listener has to already exist at that
 * moment or the tap is lost. It only routes and re-schedules — nothing here
 * reads user data, so there is nothing to leak before sign-in resolves.
 */
function useNotificationBootstrap() {
  useEffect(() => {
    void initReminderNotifications();
    return stopReminderNotifications;
  }, []);
}

/**
 * Reads device-local preferences back before the gate runs.
 *
 * The gate waits on `hydrated`: `setupCompleted` defaults to false, so
 * routing on it too early would send every returning user back through
 * first-run setup for a frame.
 */
function usePreferencesBootstrap() {
  const hydrate = usePreferencesStore((state) => state.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
}

/**
 * Collects durable photo copies nothing refers to any more, once per launch.
 *
 * The app can be killed between "reading synced" and "photo copy deleted", and
 * nothing else would ever come back for that file — see
 * `readings/lib/pending-image-store.ts`. Gated on the migrations because it
 * reads the queue table to decide what is still claimed.
 */
function usePendingImageSweep(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    void cleanupOrphanedPendingImages();
  }, [ready]);
}

/**
 * Split from the provider so it can read the resolved scheme back out.
 * NativeWind owns the light/dark/system resolution; Tamagui and React
 * Navigation follow it. See src/theme/color-scheme.tsx.
 */
function ThemedApp() {
  const { scheme } = useColorSchemePreference();
  // Nothing may render before the local tables exist — screens read from
  // SQLite on mount, and a missing table is a crash, not an empty list.
  const migrations = useDatabaseMigrations();
  useAuthBootstrap();
  useNotificationBootstrap();
  usePreferencesBootstrap();
  usePendingImageSweep(migrations.success);

  if (migrations.error) throw migrations.error;

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <ThemeProvider value={navigationThemeFor(scheme)}>
        <AnimatedSplashOverlay />
        {/* Wraps the whole navigator, not a screen: the app lock has to hold
            whatever route the user was on when they left, and a per-screen
            version leaves whichever screen forgot it as an open door. It is
            a no-op — rendering children straight through — for the majority
            who never turn the lock on. */}
        {/* Inside the migrations gate because it reads the queue and the
            mirror, and outside `AppLockGate` on purpose: a locked app should
            still be draining and pulling, so unlocking lands on fresh data
            rather than on a spinner. */}
        {migrations.success ? (
          <ReadingsSyncProvider>
            <AppLockGate>
              <RootStack />
            </AppLockGate>
          </ReadingsSyncProvider>
        ) : null}
      </ThemeProvider>
    </TamaguiProvider>
  );
}

/**
 * Groups own their own chrome, so no header at this level. `animation:
 * 'none'` because the only transitions here are gate redirects — animating
 * one shows the user a screen they were never meant to land on.
 */
function RootStack() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      {/* Not a `(group)`: the section belongs in the URL, so these are
          /onboarding/role and /onboarding/setup rather than /role and
          /setup, which would read as unrelated top-level screens. */}
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
      {/* Pushed modally from any tab, shared by both roles — see the note
          at the top of app/settings.tsx. A real navigation, not a gate
          redirect, so it gets an actual transition. */}
      <Stack.Screen
        name="settings"
        options={{ animation: 'slide_from_right' }}
      />
      {/* The rest of the menu's rows — see app/(tabs)/menu.tsx. All real
          screens now except `debug`, which is still a ScreenPlaceholder;
          registering them all means every row navigates somewhere rather
          than into a dead link. */}
      <Stack.Screen
        name="profile"
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="invitations"
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="security"
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen name="reminders" options={{ animation: 'slide_from_right' }} />
      {/* Pushed from the home screen's bell. Was a <Modal> in client-old. */}
      <Stack.Screen name="alerts" options={{ animation: 'slide_from_right' }} />
      {/* Pushed from the history tab. `reading/[id]` was a <Modal> too. */}
      <Stack.Screen name="history-list" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="reading/[id]" options={{ animation: 'slide_from_right' }} />
      {/* Not a menu row — pushed from a post in the community feed, and the
          one route here that a deep link can land on cold. */}
      <Stack.Screen name="post/[id]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="help" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="about" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="debug" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Created in state, not at module scope, so a fast refresh does not leave
  // two clients alive with different caches.
  const [queryClient] = useState(createQueryClient);

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <QueryClientProvider client={queryClient}>
          <ColorSchemeProvider storage={AsyncStorage}>
            <ThemedApp />
          </ColorSchemeProvider>
        </QueryClientProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
