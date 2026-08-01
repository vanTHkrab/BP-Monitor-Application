/**
 * Device-local app preferences.
 *
 * Global for the same reason the session is: several unrelated screens read
 * these, and none of them should have to import a feature module to do it.
 *
 * Local on purpose — none of this is server state. A reinstall losing the
 * font size is correct behaviour, not a bug, and it is why the first-run
 * setup step is gated on a *local* flag while the role step is gated on a
 * server column. See docs/todo/CLIENT-onboarding.md.
 *
 * Theme is **not** here: it lives in ColorSchemeProvider, because NativeWind
 * has to own the light/dark resolution. This store persists everything else
 * and the setup screen writes both.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from '@/config';
import { readWithLegacyFallback } from '@/lib/storage-migration';

/**
 * Elderly-first: `medium` is the default rather than the smallest rung, and
 * the ladder must stay monotonic. The old client documented a readability
 * floor of ~11px for body text — honour it wherever these are consumed.
 */
export const FONT_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type FontSizePreference = (typeof FONT_SIZES)[number];

const FONT_SIZE_KEY = STORAGE_KEYS.fontSize;
const SETUP_DONE_KEY = STORAGE_KEYS.setupCompleted;

const isFontSize = (value: unknown): value is FontSizePreference =>
  FONT_SIZES.includes(value as FontSizePreference);

export type PreferencesState = {
  fontSize: FontSizePreference;
  /** True once the first-run setup step has been completed on this device. */
  setupCompleted: boolean;
  /**
   * False until AsyncStorage has been read. The onboarding gate must wait
   * for this — acting on the default would bounce a returning user back
   * into setup for a frame on every launch.
   */
  hydrated: boolean;
};

export type PreferencesActions = {
  hydrate: () => Promise<void>;
  setFontSize: (size: FontSizePreference) => Promise<void>;
  completeSetup: () => Promise<void>;
};

const initialState: PreferencesState = {
  fontSize: 'medium',
  setupCompleted: false,
  hydrated: false,
};

export const usePreferencesStore = create<PreferencesState & PreferencesActions>((set) => ({
  ...initialState,

  hydrate: async () => {
    try {
      // Falls back to the pre-rename keys, or an upgrading user is walked
      // through first-run setup again and loses their font size — see
      // `config/storage-keys.ts`.
      const [fontSize, setupCompleted] = await Promise.all([
        readWithLegacyFallback(FONT_SIZE_KEY, LEGACY_STORAGE_KEYS.fontSize),
        readWithLegacyFallback(SETUP_DONE_KEY, LEGACY_STORAGE_KEYS.setupCompleted),
      ]);

      set({
        fontSize: isFontSize(fontSize) ? fontSize : initialState.fontSize,
        setupCompleted: setupCompleted === 'true',
        hydrated: true,
      });
    } catch {
      // A broken AsyncStorage must not wedge the app on the splash screen.
      // Defaults plus `hydrated: true` means the user gets a working app and
      // is asked to set up again — recoverable, unlike hanging.
      set({ hydrated: true });
    }
  },

  setFontSize: async (fontSize) => {
    // Optimistic: the preview on the setup screen has to react immediately,
    // and a failed write costs a preference, not data.
    set({ fontSize });
    try {
      await AsyncStorage.setItem(FONT_SIZE_KEY, fontSize);
    } catch {
      // Persisted next time the user touches it.
    }
  },

  completeSetup: async () => {
    set({ setupCompleted: true });
    try {
      await AsyncStorage.setItem(SETUP_DONE_KEY, 'true');
    } catch {
      // Worst case the step is shown again on the next launch. Blocking the
      // user inside onboarding over a storage failure would be worse.
    }
  },
}));

/** Test-only reset. Zustand stores are module singletons and leak across cases. */
export const resetPreferencesStore = () => usePreferencesStore.setState(initialState);
