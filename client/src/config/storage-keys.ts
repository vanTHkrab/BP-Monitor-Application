/**
 * Every device-storage key the app writes, in one place.
 *
 * The problem this solves is not tidiness. Keys were minted next to the code
 * that used them and drifted into three separator conventions — `bp:`, `bp_`,
 * and `bp.` — with kebab and snake casing mixed in. Nothing checked for
 * collisions, so a future key that happened to repeat an existing one would
 * silently overwrite somebody's data, and the only way to notice was to read
 * five unrelated files.
 *
 * **The convention is `bp.<snake_case>`**, and the reason is a constraint,
 * not a preference: `expo-secure-store` rejects keys outside
 * `/^[A-Za-z0-9._-]+$/`, so a colon cannot be used by anything that might
 * ever move to SecureStore. The two newest keys (`app_lock`, reminders)
 * already follow it.
 *
 * `LEGACY_STORAGE_KEYS` holds what each renamed key used to be. They are read
 * once as a fallback so an upgrading user keeps their theme, font size, and
 * setup flag instead of silently landing back on the defaults; see
 * `lib/storage-migration.ts`. A key with no legacy entry never had another
 * name.
 */

export const STORAGE_KEYS = {
  /**
   * The one key that does **not** follow the convention, deliberately.
   * It already migrated once, from `bp:auth-token`, when it moved to
   * SecureStore (colons are illegal there). Renaming it a second time for
   * cosmetic consistency would put every signed-in user's session behind
   * another migration, and the failure mode of that going wrong is a silent
   * mass logout. Not worth a dot.
   */
  authToken: 'bp_auth_token',

  /**
   * Who the stored token belongs to, mirrored device-side.
   *
   * Not a credential and not a source of truth — `me` is. It exists so a
   * cold start with no network can still say *whose* local readings to show:
   * without it, an offline launch has a valid token, no user id, and
   * therefore an empty history on a device that holds every row.
   */
  sessionUserId: 'bp.session_user_id',

  themePreference: 'bp.theme_preference',
  fontSize: 'bp.font_size',
  setupCompleted: 'bp.setup_completed',
  appLock: 'bp.app_lock_enabled',
  autoCapture: 'bp.auto_capture_enabled',

  /**
   * The Expo push token this **installation** last registered with the
   * gateway.
   *
   * Not per user, and that is the whole point: an `ExponentPushToken[…]`
   * identifies the app install, not the account, and the gateway's `PushToken`
   * row is deliberately not session-scoped so it survives session rotation.
   * The device therefore has to remember the token it registered, because
   * logout is the one moment it must tell the gateway which row to delete and
   * the OS may not hand the token back (permission revoked, no network).
   *
   * Not a credential — an Expo push token is a delivery address, not an
   * authenticator — so AsyncStorage rather than SecureStore.
   */
  pushToken: 'bp.push_token',
} as const;

/**
 * Reminder settings are stored per user, so the key is built rather than
 * fixed. `guest` covers the pre-sign-in window, where a schedule can be
 * previewed but not attached to anyone.
 */
export const reminderSettingsKey = (userId?: string): string =>
  `bp.reminder_settings.${userId ?? 'guest'}`;

/**
 * Which caregiver invites this device has already announced, per user.
 *
 * Per user for the same reason as the reminder key, and more sharply: two
 * accounts on one phone must not silence each other's invites, and an invite
 * announced to the previous user must not be treated as seen by the next.
 */
export const announcedInvitesKey = (userId?: string): string =>
  `bp.announced_invites.${userId ?? 'guest'}`;

/**
 * Whether this user has already been told, on this device, that notifications
 * are switched off and critical alerts will not reach them.
 *
 * Per user rather than per install: the sentence is about *your* alerts, and
 * on a shared handset the second account has never heard it. The flag exists
 * so the app says it once and then stops — a launch-time nag about a
 * permission the user deliberately declined is how an app earns being
 * uninstalled rather than re-enabled.
 */
export const pushDenialNoticeKey = (userId?: string): string =>
  `bp.push_denial_notice.${userId ?? 'guest'}`;

/** What a key used to be called. Read once, then deleted. */
export const LEGACY_STORAGE_KEYS = {
  authToken: 'bp:auth-token',
  themePreference: 'bp:theme-preference',
  fontSize: 'bp:font-size-preference',
  setupCompleted: 'bp:app-setup-completed',
} as const;

export type StorageKeyName = keyof typeof STORAGE_KEYS;
