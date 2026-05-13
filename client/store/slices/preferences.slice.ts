import { GQL_LOGIN, graphqlRequest } from "@/constants/api";
import { FontSizePreference } from "@/types";
import type { LoginMutation } from "@/types/graphql";
import { errorMessage } from "@/types/graphql";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StateCreator } from "zustand";
import { authErrorToThai } from "../shared/error-format";
import type { AppState } from "../use-app-store";

const THEME_STORAGE_KEY = "bp:theme-preference";
const FONT_SIZE_PREFERENCE_KEY = "bp:font-size-preference";
const HIDE_SENSITIVE_DATA_KEY = "bp:hide-sensitive-data";

export interface PreferencesSlice {
  themePreference: "light" | "dark";
  themeHydrated: boolean;
  fontSizePreference: FontSizePreference;
  hideSensitiveData: boolean;
  sensitiveDataUnlocked: boolean;

  hydrateTheme: () => Promise<void>;
  setThemePreference: (pref: "light" | "dark") => Promise<void>;
  hydrateAccessibilityPreferences: () => Promise<void>;
  setFontSizePreference: (pref: FontSizePreference) => Promise<void>;
  hydrateSecurityPreferences: () => Promise<void>;
  setHideSensitiveData: (enabled: boolean) => Promise<void>;
  unlockSensitiveData: (password: string) => Promise<boolean>;
  lockSensitiveData: () => void;
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
    const currentUser = get().user;
    if (!currentUser) return false;

    try {
      await graphqlRequest<LoginMutation>(GQL_LOGIN, {
        input: {
          phone: currentUser.phone,
          password,
        },
      });
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
});
