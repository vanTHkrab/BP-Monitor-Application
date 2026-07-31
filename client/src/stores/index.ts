/**
 * Global stores — state that outlives any one feature and that several
 * modules read.
 *
 * Feature-local state does not belong here. Server data does not belong here
 * either: if it has a SQLite mirror it lives in the database, and if it does
 * not it lives in TanStack Query (see services/query-client.ts).
 */
export { useAuthStore, resetAuthStore } from './auth.store';
export type { AuthStatus, AuthState, AuthActions } from './auth.store';

export {
  usePreferencesStore,
  resetPreferencesStore,
  FONT_SIZES,
} from './preferences.store';
export type {
  FontSizePreference,
  PreferencesState,
  PreferencesActions,
} from './preferences.store';
