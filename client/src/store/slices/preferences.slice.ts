import { graphqlRequest } from "@/src/core/graphql/client";
import { GQL_VERIFY_PASSWORD } from "@/src/core/graphql/operations";
import { kvStorage } from "@/src/core/storage/mmkv.storage";
import { KV_KEYS } from "@/src/core/storage/storage.keys";
import { FontSizePreference } from "@/src/types";
import type { VerifyPasswordMutation } from "@/src/types/graphql";
import { errorMessage } from "@/src/types/graphql";
import type { StateCreator } from "zustand";
import { authErrorToThai } from "../shared/error-format";
import type { AppState } from "../use-app-store";

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
    const raw = await kvStorage.getString(KV_KEYS.THEME_PREFERENCE);
    const pref = raw === "dark" ? "dark" : raw === "light" ? "light" : null;
    set({ themePreference: pref ?? "light", themeHydrated: true });
  },

  setThemePreference: async (pref) => {
    set({ themePreference: pref });
    await kvStorage.setString(KV_KEYS.THEME_PREFERENCE, pref);
  },

  hydrateAccessibilityPreferences: async () => {
    const raw = await kvStorage.getString(KV_KEYS.FONT_SIZE_PREFERENCE);
    if (raw === "xsmall") {
      await kvStorage.setString(KV_KEYS.FONT_SIZE_PREFERENCE, "small");
    }
    const normalized =
      raw === "xsmall"
        ? "small"
        : raw === "small" || raw === "large" || raw === "xlarge"
          ? raw
          : "medium";
    set({ fontSizePreference: normalized });
  },

  setFontSizePreference: async (pref) => {
    set({ fontSizePreference: pref });
    await kvStorage.setString(KV_KEYS.FONT_SIZE_PREFERENCE, pref);
  },

  hydrateSecurityPreferences: async () => {
    const raw = await kvStorage.getString(KV_KEYS.HIDE_SENSITIVE_DATA);
    set({
      hideSensitiveData: raw === "true",
      sensitiveDataUnlocked: false,
    });
  },

  setHideSensitiveData: async (enabled) => {
    set({
      hideSensitiveData: enabled,
      sensitiveDataUnlocked: enabled ? false : true,
    });
    await kvStorage.setString(
      KV_KEYS.HIDE_SENSITIVE_DATA,
      enabled ? "true" : "false",
    );
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
});
