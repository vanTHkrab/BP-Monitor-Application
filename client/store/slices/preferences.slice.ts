import { GQL_VERIFY_PASSWORD, graphqlRequest } from "@/constants/api";
import { FontSizePreference, OCR_ENGINES, type OcrEngine } from "@/types";
import type { VerifyPasswordMutation } from "@/types/graphql";
import { errorMessage } from "@/types/graphql";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StateCreator } from "zustand";
import { authErrorToThai } from "../shared/error-format";
import type { AppState } from "../use-app-store";

const THEME_STORAGE_KEY = "bp:theme-preference";
const FONT_SIZE_PREFERENCE_KEY = "bp:font-size-preference";
const HIDE_SENSITIVE_DATA_KEY = "bp:hide-sensitive-data";
// Dev-only OCR engine override (M2.2 comparison phase). Persists across
// app restarts so a researcher doesn't have to re-trigger the gesture
// every session — a reinstall wipes the value, which is fine for the
// "hide-from-end-users" goal.
const DEV_MODE_KEY = "bp:dev-mode";
const SELECTED_OCR_ENGINE_KEY = "bp:selected-ocr-engine";

export interface PreferencesSlice {
  themePreference: "light" | "dark";
  themeHydrated: boolean;
  fontSizePreference: FontSizePreference;
  hideSensitiveData: boolean;
  sensitiveDataUnlocked: boolean;
  // Dev-only OCR engine comparison flow. ``devMode`` is the gate; while
  // false the rest of the app behaves exactly like production (no UI,
  // mutation omits the engine field). ``selectedOcrEngine`` is the
  // active pick when ``devMode`` is true.
  devMode: boolean;
  selectedOcrEngine: OcrEngine;

  hydrateTheme: () => Promise<void>;
  setThemePreference: (pref: "light" | "dark") => Promise<void>;
  hydrateAccessibilityPreferences: () => Promise<void>;
  setFontSizePreference: (pref: FontSizePreference) => Promise<void>;
  hydrateSecurityPreferences: () => Promise<void>;
  setHideSensitiveData: (enabled: boolean) => Promise<void>;
  unlockSensitiveData: (password: string) => Promise<boolean>;
  lockSensitiveData: () => void;
  hydrateDevPreferences: () => Promise<void>;
  toggleDevMode: () => Promise<boolean>;
  setSelectedOcrEngine: (engine: OcrEngine) => Promise<void>;
}

export const createPreferencesSlice: StateCreator<
  AppState,
  [],
  [],
  PreferencesSlice
> = (set, get) => ({
  themePreference: "light",
  themeHydrated: false,
  fontSizePreference: "medium",
  hideSensitiveData: false,
  sensitiveDataUnlocked: false,
  devMode: false,
  selectedOcrEngine: "crnn",

  hydrateTheme: async () => {
    try {
      const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      const pref = raw === "dark" ? "dark" : raw === "light" ? "light" : null;
      set({ themePreference: pref ?? "light", themeHydrated: true });
    } catch {
      set({ themeHydrated: true });
    }
  },

  setThemePreference: async (pref) => {
    set({ themePreference: pref });
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // ignore
    }
  },

  hydrateAccessibilityPreferences: async () => {
    try {
      const raw = await AsyncStorage.getItem(FONT_SIZE_PREFERENCE_KEY);
      if (raw === "xsmall") {
        await AsyncStorage.setItem(FONT_SIZE_PREFERENCE_KEY, "small");
      }
      const normalized =
        raw === "xsmall"
          ? "small"
          : raw === "small" || raw === "large" || raw === "xlarge"
            ? raw
            : "medium";
      set({
        fontSizePreference: normalized,
      });
    } catch {
      set({ fontSizePreference: "medium" });
    }
  },

  setFontSizePreference: async (pref) => {
    set({ fontSizePreference: pref });
    try {
      await AsyncStorage.setItem(FONT_SIZE_PREFERENCE_KEY, pref);
    } catch {
      // ignore
    }
  },

  hydrateSecurityPreferences: async () => {
    try {
      const raw = await AsyncStorage.getItem(HIDE_SENSITIVE_DATA_KEY);
      set({
        hideSensitiveData: raw === "true",
        sensitiveDataUnlocked: false,
      });
    } catch {
      set({ sensitiveDataUnlocked: false });
    }
  },

  setHideSensitiveData: async (enabled) => {
    set({
      hideSensitiveData: enabled,
      sensitiveDataUnlocked: enabled ? false : true,
    });

    try {
      await AsyncStorage.setItem(
        HIDE_SENSITIVE_DATA_KEY,
        enabled ? "true" : "false",
      );
    } catch {
      // ignore
    }
  },

  unlockSensitiveData: async (password) => {
    const token = get().authToken;
    if (!token) return false;

    try {
      await graphqlRequest<VerifyPasswordMutation>(
        GQL_VERIFY_PASSWORD,
        { password },
        token,
      );
      set({ sensitiveDataUnlocked: true });
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "auth/unlock-sensitive-data-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  lockSensitiveData: () => {
    if (get().hideSensitiveData) {
      set({ sensitiveDataUnlocked: false });
    }
  },

  hydrateDevPreferences: async () => {
    try {
      const [rawDev, rawEngine] = await Promise.all([
        AsyncStorage.getItem(DEV_MODE_KEY),
        AsyncStorage.getItem(SELECTED_OCR_ENGINE_KEY),
      ]);
      const engine =
        rawEngine && (OCR_ENGINES as readonly string[]).includes(rawEngine)
          ? (rawEngine as OcrEngine)
          : "crnn";
      set({ devMode: rawDev === "true", selectedOcrEngine: engine });
    } catch {
      // AsyncStorage failures are non-fatal — fall back to defaults
      // (production behaviour) rather than blocking app boot.
    }
  },

  toggleDevMode: async () => {
    const next = !get().devMode;
    set({ devMode: next });
    try {
      await AsyncStorage.setItem(DEV_MODE_KEY, next ? "true" : "false");
    } catch {
      // ignore — toggle still works in-memory until restart
    }
    return next;
  },

  setSelectedOcrEngine: async (engine) => {
    set({ selectedOcrEngine: engine });
    try {
      await AsyncStorage.setItem(SELECTED_OCR_ENGINE_KEY, engine);
    } catch {
      // ignore
    }
  },
});
