/**
 * Two things that run once at app start and are not hooks.
 *
 * Kept out of module scope and behind an explicit call so a test can control
 * when they happen — the old client registered its 401 handler as a
 * side effect of composing the store, which meant importing the store from
 * a test installed a global handler nobody asked for.
 */
import { clearAuthToken, getAuthToken } from "@/services/auth-token";
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
    signedIn({ userId: user.id, token });
  } catch {
    // Any failure here — revoked, expired, or offline — lands on the login
    // screen. Keeping a token we could not verify is the state that makes
    // "logged in but nothing loads" possible.
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
