/**
 * Owns the app's colour scheme.
 *
 * The user picks one of three preferences — `light`, `dark`, or `system`
 * (the default) — and that single choice has to reach three independent
 * styling systems that each keep their own copy of "am I dark right now?":
 *
 *   1. NativeWind  → the `dark:` variant / `.dark:root` CSS variables
 *   2. Tamagui     → <TamaguiProvider defaultTheme>
 *   3. Navigation  → <ThemeProvider value> (screen bg, header, tab bar)
 *
 * Rather than tracking the OS ourselves and syncing three ways, NativeWind
 * is made the owner: it already understands `system` and re-resolves on OS
 * change. We write the preference to it and read the *resolved* scheme back
 * out, then hand that one value to the other two. That keeps a single
 * source of truth and removes the class of bug where one system lags the
 * others by a render.
 */
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';
import { colorScheme as nativewindColorScheme, useColorScheme } from 'nativewind';

import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from '@/config';
import type { ColorSchemeName } from './tokens';

export type ColorSchemePreference = 'light' | 'dark' | 'system';

/**
 * Minimal async key-value contract, satisfied by AsyncStorage.
 *
 * Injected rather than imported so this module has no storage dependency:
 * without a `storage` prop the preference simply lives for the session.
 */
export type PreferenceStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

const STORAGE_KEY = STORAGE_KEYS.themePreference;
const LEGACY_STORAGE_KEY = LEGACY_STORAGE_KEYS.themePreference;

/**
 * Reads the preference, falling back to the pre-rename key so an upgrading
 * user does not snap back to `system` — see `config/storage-keys.ts`.
 *
 * Written through `storage` rather than `lib/storage-migration.ts` because
 * this provider takes its storage as a prop and must not import AsyncStorage
 * itself. The consequence is that the old key is rewritten forward but never
 * deleted: `PreferenceStorage` has no `removeItem`, and widening that
 * interface to delete one obsolete key on one launch is not worth it. The
 * stale copy is read at most once, since the new key wins from then on.
 */
async function readPreference(storage: PreferenceStorage): Promise<string | null> {
  const current = await storage.getItem(STORAGE_KEY);
  if (current !== null) return current;

  const legacy = await storage.getItem(LEGACY_STORAGE_KEY);
  if (legacy !== null) await storage.setItem(STORAGE_KEY, legacy);

  return legacy;
}

const PREFERENCES: readonly ColorSchemePreference[] = ['light', 'dark', 'system'];

function isPreference(value: unknown): value is ColorSchemePreference {
  return PREFERENCES.includes(value as ColorSchemePreference);
}

type ColorSchemeContextValue = {
  /** What the user chose. */
  preference: ColorSchemePreference;
  /** What that resolves to right now — never `system`. */
  scheme: ColorSchemeName;
  setPreference: (preference: ColorSchemePreference) => void;
  /** False until a persisted preference has been read back. */
  hydrated: boolean;
};

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

export function ColorSchemeProvider({
  children,
  storage,
}: {
  children: React.ReactNode;
  storage?: PreferenceStorage;
}) {
  const [preference, setPreferenceState] = useState<ColorSchemePreference>('system');
  const [hydrated, setHydrated] = useState(!storage);

  // NativeWind resolves `system` against the OS and updates on change.
  const { colorScheme } = useColorScheme();
  const scheme: ColorSchemeName = colorScheme === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    if (!storage) return;

    let cancelled = false;
    readPreference(storage)
      .then((stored) => {
        if (cancelled) return;
        if (isPreference(stored)) {
          setPreferenceState(stored);
          nativewindColorScheme.set(stored);
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [storage]);

  const setPreference = useCallback(
    (next: ColorSchemePreference) => {
      setPreferenceState(next);
      nativewindColorScheme.set(next);
      void storage?.setItem(STORAGE_KEY, next);
    },
    [storage],
  );

  const value = useMemo(
    () => ({ preference, scheme, setPreference, hydrated }),
    [preference, scheme, setPreference, hydrated],
  );

  return <ColorSchemeContext value={value}>{children}</ColorSchemeContext>;
}

export function useColorSchemePreference(): ColorSchemeContextValue {
  const context = use(ColorSchemeContext);
  if (!context) {
    throw new Error('useColorSchemePreference must be used inside <ColorSchemeProvider>');
  }
  return context;
}
