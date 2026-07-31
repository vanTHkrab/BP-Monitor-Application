/**
 * Global session state.
 *
 * Deliberately a dumb container: state and setters, no network, and no
 * imports from `src/modules/`. The actions that talk to the gateway live in
 * `src/modules/auth/`, which writes into this store. Keeping the direction
 * one-way is what lets an unrelated module read `userId` without pulling the
 * auth module's GraphQL operations into its import graph.
 *
 * What lives here is the *minimum routing needs synchronously*: is there a
 * session, whose is it, and do we know yet. The full user profile is server
 * data with no local mirror, so it belongs to the `me` query in TanStack
 * Query (see services/query-client.ts) — holding a second copy here would
 * mean two caches for one entity, drifting apart on every profile edit.
 */
import { create } from 'zustand';

/**
 * `unknown` is the pre-hydration state and is why the gate cannot simply
 * treat "no token" as "logged out": on a cold start the token is still
 * being read out of SecureStore, and redirecting to /login on that would
 * flash the login screen at every returning user.
 */
export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';

export type AuthState = {
  status: AuthStatus;
  userId: string | null;
  /**
   * Mirrored here only so `status` and the credential can never disagree.
   * Requests read the token through `services/auth-token.ts`; nothing should
   * pull it from the store to build a header.
   */
  token: string | null;
  /**
   * Set when a session ends for a reason worth explaining on the login
   * screen — currently only expiry. Ordinary sign-out leaves it null.
   */
  endedReason: 'session-expired' | null;
};

export type AuthActions = {
  signedIn: (input: { userId: string; token: string }) => void;
  signedOut: (reason?: AuthState['endedReason']) => void;
  /** Hydration finished and found no session. */
  resolvedAnonymous: () => void;
  clearEndedReason: () => void;
};

const initialState: AuthState = {
  status: 'unknown',
  userId: null,
  token: null,
  endedReason: null,
};

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  ...initialState,

  signedIn: ({ userId, token }) =>
    set({ status: 'authenticated', userId, token, endedReason: null }),

  signedOut: (reason = null) =>
    set({ status: 'unauthenticated', userId: null, token: null, endedReason: reason }),

  resolvedAnonymous: () => set({ status: 'unauthenticated', userId: null, token: null }),

  clearEndedReason: () => set({ endedReason: null }),
}));

/**
 * Test-only reset. Zustand stores are module singletons, so state written by
 * one case is still there in the next. Merges rather than replaces — a
 * replace would drop the actions along with the state.
 */
export const resetAuthStore = () => useAuthStore.setState(initialState);
