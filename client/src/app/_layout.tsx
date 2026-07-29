import '../global.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { SplashScreen, ThemeProvider } from 'expo-router';
import { useState } from 'react';
import { TamaguiProvider } from 'tamagui';

import tamaguiConfig from '../../tamagui.config';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { useDatabaseMigrations } from '@/database/migrator';
import { createQueryClient } from '@/services/query-client';
import { navigationThemeFor } from '@/theme';
import { ColorSchemeProvider, useColorSchemePreference } from '@/theme/color-scheme';

SplashScreen.preventAutoHideAsync();

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

  if (migrations.error) throw migrations.error;

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
      <ThemeProvider value={navigationThemeFor(scheme)}>
        <AnimatedSplashOverlay />
        {migrations.success ? <AppTabs /> : null}
      </ThemeProvider>
    </TamaguiProvider>
  );
}

export default function RootLayout() {
  // Created in state, not at module scope, so a fast refresh does not leave
  // two clients alive with different caches.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ColorSchemeProvider>
        <ThemedApp />
      </ColorSchemeProvider>
    </QueryClientProvider>
  );
}
