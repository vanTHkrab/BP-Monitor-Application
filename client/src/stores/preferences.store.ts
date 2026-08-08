/**
 * Device-local app preferences.
 *
 * Global for the same reason the session is: several unrelated screens read
 * these, and none of them should have to import a feature module to do it.
 *
 * Local on purpose — none of this is server state. A reinstall losing the
 * font size is correct behaviour, not a bug, and it is why the first-run
 * setup step is gated on a *local* flag while the role step is gated on a
 * server column. See docs/project/CLIENT-onboarding.md.
 *
 * Theme is **not** here: it lives in ColorSchemeProvider, because NativeWind
 * has to own the light/dark resolution. This store persists everything else
 * and the setup screen writes both.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from '@/config';
import { readWithLegacyFallback } from '@/lib/storage-migration';
import { isSelectableFontFamily, type FontFamilyId } from '@/theme/typography';

/**
 * Elderly-first: `medium` is the default rather than the smallest rung, and
 * the ladder must stay monotonic. The old client documented a readability
 * floor of ~11px for body text — honour it wherever these are consumed.
 */
export const FONT_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
export type FontSizePreference = (typeof FONT_SIZES)[number];

const FONT_SIZE_KEY = STORAGE_KEYS.fontSize;
const FONT_FAMILY_KEY = STORAGE_KEYS.fontFamily;
const SETUP_DONE_KEY = STORAGE_KEYS.setupCompleted;
const AUTO_CAPTURE_KEY = STORAGE_KEYS.autoCapture;

const isFontSize = (value: unknown): value is FontSizePreference =>
  FONT_SIZES.includes(value as FontSizePreference);

/*
 * `isSelectableFontFamily` is not defined here, unlike `isFontSize` above,
 * and the asymmetry is deliberate: a validator belongs beside the list it
 * validates against. `FONT_SIZES` lives in this file, so its guard does too;
 * `FONT_FAMILIES` lives in `theme/typography.ts` alongside the file names and
 * optical scales, so adding a family there cannot leave a guard behind in a
 * store that has no other reason to know about typefaces.
 *
 * Note it is the *selectable* guard, not `isFontFamily`. `mono` is a real
 * family and a legitimate per-node override, but it is Latin-only, so holding
 * it as the app-wide preference would drop every Thai string to the OEM face.
 * The picker cannot offer it; this makes sure nothing else can either.
 */

export type PreferencesState = {
  fontSize: FontSizePreference;
  /**
   * The typeface. Device-local like the rest of this store — it is a
   * readability choice about this screen, not a fact about the account.
   */
  fontFamily: FontFamilyId;
  /** True once the first-run setup step has been completed on this device. */
  setupCompleted: boolean;
  /**
   * Whether the camera may fire its own shutter once the framing gate is
   * happy. On by default — steadying a phone over a monitor and then reaching
   * for a button is exactly when the shot moves — and it gates only the
   * countdown, never the coaching or the manual button.
   */
  autoCapture: boolean;
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
  setFontFamily: (family: FontFamilyId) => Promise<void>;
  setAutoCapture: (enabled: boolean) => Promise<void>;
  completeSetup: () => Promise<void>;
};

const initialState: PreferencesState = {
  fontSize: 'medium',
  // Noto is the app's shipped typeface and the only one loaded before first
  // paint — see `app/_layout.tsx`. Defaulting anywhere else would make every
  // cold start render one face and then swap.
  fontFamily: 'noto',
  autoCapture: true,
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
      const [fontSize, fontFamily, setupCompleted, autoCapture] = await Promise.all([
        readWithLegacyFallback(FONT_SIZE_KEY, LEGACY_STORAGE_KEYS.fontSize),
        // No legacy fallback: this key is new, so there is no earlier name it
        // could have been written under.
        AsyncStorage.getItem(FONT_FAMILY_KEY),
        readWithLegacyFallback(SETUP_DONE_KEY, LEGACY_STORAGE_KEYS.setupCompleted),
        AsyncStorage.getItem(AUTO_CAPTURE_KEY),
      ]);

      set({
        fontSize: isFontSize(fontSize) ? fontSize : initialState.fontSize,
        // Validated rather than cast, and against the *selectable* set. A
        // family removed in a later release would otherwise be read straight
        // back out of storage and named as a `fontFamily` nothing loads; a
        // stored `'mono'` would be worse still, since it loads fine and has no
        // Thai glyphs. Both fail silently to the OEM system face.
        fontFamily: isSelectableFontFamily(fontFamily) ? fontFamily : initialState.fontFamily,
        setupCompleted: setupCompleted === 'true',
        // Absent means never touched, which must stay the default rather than
        // reading as an opt-out.
        autoCapture: autoCapture == null ? initialState.autoCapture : autoCapture === 'true',
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

  setFontFamily: async (fontFamily) => {
    // Optimistic for the same reason as the size: the family picker renders a
    // live sample of the whole screen in the chosen face, and a write that had
    // to land first would make the control feel broken. A failed write costs a
    // preference, not data.
    set({ fontFamily });
    try {
      await AsyncStorage.setItem(FONT_FAMILY_KEY, fontFamily);
    } catch {
      // Persisted next time the user touches it.
    }
  },

  setAutoCapture: async (autoCapture) => {
    // Optimistic for the same reason as the font size: the toggle sits on the
    // camera screen and has to respond under the finger.
    set({ autoCapture });
    try {
      await AsyncStorage.setItem(AUTO_CAPTURE_KEY, String(autoCapture));
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
