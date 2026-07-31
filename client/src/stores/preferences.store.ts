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

/**
 * Elderly-first: `medium` is the default rather than the smallest rung, and
 * the ladder must stay monotonic. The old client documented a readability
 * floor of ~11px for body text — honour it wherever these are consumed.
 */
export const FONT_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type FontSizePreference = (typeof FONT_SIZES)[number];

const FONT_SIZE_KEY = 'bp:font-size-preference';
const SETUP_DONE_KEY = 'bp:app-setup-completed';

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
      const [fontSize, setupCompleted] = await AsyncStorage.multiGet([
        FONT_SIZE_KEY,
        SETUP_DONE_KEY,
      ]);

      set({
        fontSize: isFontSize(fontSize[1]) ? fontSize[1] : initialState.fontSize,
        setupCompleted: setupCompleted[1] === 'true',
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
