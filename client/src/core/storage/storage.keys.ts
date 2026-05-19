// Central registry of every storage key used by the app.
//
// SECURE_KEYS  → encrypted KV via expo-secure-store (auth tokens only).
// KV_KEYS      → unencrypted KV via MMKV (preferences, ephemeral flags).
// userKey      → per-user computed keys; pass userId or "guest".
//
// Why keys live here instead of next to their use:
//   1. one grep to enumerate every persistent surface (audit + cleanup)
//   2. accidental collisions become impossible (different slices can't
//      both invent "bp:theme" thinking the namespace is empty)
//   3. renaming a key forces touching this file → migration becomes
//      a deliberate act, not a quiet break

export const SECURE_KEYS = {
  AUTH_TOKEN: "bp_auth_token",
} as const;

export const KV_KEYS = {
  THEME_PREFERENCE: "bp:theme-preference",
  FONT_SIZE_PREFERENCE: "bp:font-size-preference",
  HIDE_SENSITIVE_DATA: "bp:hide-sensitive-data",
} as const;

// Per-user keys — pass the user's id, or "guest" sentinel for
// pre-login state. Keep formats stable; changing them silently
// orphans every existing user's saved state.
export const userKey = {
  notificationsRead: (userId?: string) =>
    `bp.notifications.read.${userId ?? "guest"}`,
  reminderSettings: (userId?: string) =>
    `bp.reminder_settings.${userId ?? "guest"}`,
} as const;
