/**
 * Two things that run once at app start and are not hooks.
 *
 * Kept out of module scope and behind an explicit call so a test can control
 * when they happen — the old client registered its 401 handler as a
 * side effect of composing the store, which meant importing the store from
 * a test installed a global handler nobody asked for.
 */
import { isNetworkError } from "@/services/api-error";
import {
  clearAuthToken,
  getAuthToken,
  getSessionUserId,
  rememberSessionUserId,
} from "@/services/auth-token";
import { setUnauthenticatedHandler } from "@/services/session";
import { useAuthStore } from "@/stores";
import { fetchMe } from "./services/auth-api";

/**
 * Restores the session from SecureStore, or resolves to anonymous.
 *
 * The stored token is verified against `me` rather than trusted: the Better
 * Auth migration revoked every pre-existing session, and a device that still
 * holds one of those would otherwise sit in `authenticated` until its first
 * real request failed.
 *
 * **Except when the network is the thing that failed.** Treating "could not
 * reach the server" like "the server rejected you" signed the user out of an
 * offline-first app the moment they opened it on a train — token deleted,
 * login screen, and a local database full of readings they could no longer
 * see. A transport-level failure now restores the session from the remembered
 * user id and lets the app run on the mirror; the very next authenticated
 * request will still 401 into `registerSessionExpiryHandler` if the token
 * really was revoked.
 */
export async function initAuth(): Promise<void> {
  const { signedIn, resolvedAnonymous } = useAuthStore.getState();

  const token = await getAuthToken();
  if (!token) {
    resolvedAnonymous();
    return;
  }

  try {
    const user = await fetchMe();
    await rememberSessionUserId(user.id);
    signedIn({ userId: user.id, token });
  } catch (error) {
    const cachedUserId = isNetworkError(error) ? await getSessionUserId() : null;
    if (cachedUserId) {
      signedIn({ userId: cachedUserId, token });
      return;
    }

    // Revoked, expired, or a first launch we could never verify. Keeping a
    // token we cannot attribute is the state that makes "logged in but
    // nothing loads" possible.
    await clearAuthToken();
    resolvedAnonymous();
  }
}

/**
 * Routes the transport's 401 fan-out into a single global sign-out.
 *
 * Idempotent by construction: `signedOut` is a plain set, so the several
 * concurrent requests that all fail at once collapse into one state change.
 * Registered here rather than per-slice — that was a recurring failure mode
 * in the old client.
 */
export function registerSessionExpiryHandler(): () => void {
  setUnauthenticatedHandler(() => {
    // Already signed out — a late 401 from an in-flight request should not
    // re-raise the banner after the user chose to leave.
    if (useAuthStore.getState().status !== "authenticated") return;

    useAuthStore.getState().signedOut("session-expired");
    void clearAuthToken();
  });

  return () => setUnauthenticatedHandler(null);
}

/**
 * Keeps the remembered user id in step with the store, from one place.
 *
 * A subscription rather than a write at each of the five sign-in paths
 * (password, register, Google, passkey, restore): those are exactly the kind
 * of list a sixth path forgets to join, and the failure would be invisible
 * until someone opened the app offline months later. The store stays a dumb
 * container — the I/O is out here, watching it.
 */
export function registerSessionUserMirror(): () => void {
  return useAuthStore.subscribe((state, previous) => {
    if (state.userId === previous.userId) return;
    if (state.userId) void rememberSessionUserId(state.userId);
    // The signed-out branch is deliberately absent: `clearAuthToken` already
    // forgets the id, and both sign-out paths call it. Clearing here as well
    // would race that write.
  });
}
