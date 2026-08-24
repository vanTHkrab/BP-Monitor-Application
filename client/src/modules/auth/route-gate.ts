/**
 * Where the app entry route should send someone.
 *
 * Pure and separate from the screen so the rule is assertable in a unit test
 * rather than only observable by launching the app.
 *
 * Two things this encodes that are easy to get wrong:
 *
 *  - **`wait` is not "logged out".** Collapsing it into a redirect is how a
 *    returning user sees the login screen flash before their own data loads.
 *    There are now two sources to wait for: the session, and the local
 *    preferences that say whether first-run setup is done.
 *
 *  - **Onboarding is ordered and resumable.** Each step is gated on its own
 *    signal, so someone who force-quits halfway resumes where they stopped
 *    instead of starting over or skipping ahead.
 *
 * ## Why display setup runs before login
 *
 * It used to run last: login, then role, then setup. Two things were wrong
 * with that, and the second is the structural one.
 *
 *  1. **The login and register screens are themselves text.** Gating the
 *     text-size control behind them asks a user who cannot read small text to
 *     read a login form first, in order to reach the control that fixes small
 *     text. For an elderly-first product that is the wrong way round, and it
 *     is the same argument `font-size-picker.tsx` makes about previewing sizes
 *     rather than labelling them.
 *
 *  2. **`setupCompleted` is a device-local AsyncStorage flag, not a server
 *     column.** Hanging a per-device gate off a per-session signal is a
 *     mismatch of scope: the answer to "has this phone been set up" does not
 *     depend on who is signed in on it, so waiting for a session before
 *     asking it was waiting on the wrong thing.
 *
 * `roleSelected` is the opposite on both counts and therefore stays after
 * auth: it writes to the server, so it needs a session to write with.
 */
import type { AuthStatus } from '@/stores';

export type GateHref =
  | '/(tabs)'
  | '/login'
  | '/onboarding-phone'
  | '/onboarding/role'
  | '/onboarding/setup';

export type GateDestination =
  /** Something is still hydrating — hold on the entry screen. */
  { kind: 'wait' } | { kind: 'redirect'; href: GateHref };

export type GateInput = {
  status: AuthStatus;
  /**
   * From `User.roleSelectedAt` being non-null — **not** from `role`. `role`
   * defaults to `patient`, so on its own it cannot distinguish "chose
   * patient" from "never chose", and the step would either repeat forever or
   * never run.
   *
   * `null` means the answer is not known yet (the `me` query is in flight).
   */
  roleSelected: boolean | null;
  /**
   * From `User.phone` being present.
   *
   * A Google account is created by `signInSocial` before any screen can ask
   * for anything, and a Google ID token carries no phone number — so this is
   * the one onboarding signal that can be false for an account the user did
   * not knowingly half-finish. `users.phone` is nullable for exactly that
   * reason, and nothing in the database enforces the requirement any more;
   * this gate is what does.
   *
   * It matters more than it looks: caregivers find patients by phone, and the
   * invite lookup is an equality match that cannot match a NULL. Until this
   * is true the account exists but is unreachable.
   *
   * `null` means the answer is not known yet, same as `roleSelected`.
   */
  phoneComplete: boolean | null;
  /** Local flag. False means first-run setup is still due on this device. */
  appConfigured: boolean;
  /** False until AsyncStorage has been read back. */
  preferencesHydrated: boolean;
};

export function resolveGate({
  status,
  roleSelected,
  phoneComplete,
  appConfigured,
  preferencesHydrated,
}: GateInput): GateDestination {
  // Device-local, and answered first — see the header. Nothing about this
  // question involves the session, so it does not wait for one.
  if (!preferencesHydrated) return { kind: 'wait' };
  if (!appConfigured) return { kind: 'redirect', href: '/onboarding/setup' };

  if (status === 'unknown') return { kind: 'wait' };
  if (status === 'unauthenticated') return { kind: 'redirect', href: '/login' };

  /*
   * Signed in from here on. Both remaining signals are server state, so both
   * can be `null` while `me` is in flight — and `null` is not "not done".
   * Treating it as the latter flashes an onboarding screen at someone who
   * finished months ago.
   *
   * Phone before role, and the order is not arbitrary: a missing phone means
   * the account is unreachable by any caregiver, while a missing role only
   * means the app does not yet know which tabs to show. Asking for the
   * reachable identity first also matches how a Google account was made —
   * everything else arrived from the provider, and this is the one thing only
   * the user can supply.
   */
  if (phoneComplete === null) return { kind: 'wait' };
  if (!phoneComplete) return { kind: 'redirect', href: '/onboarding-phone' };

  if (roleSelected === null) return { kind: 'wait' };
  if (!roleSelected) return { kind: 'redirect', href: '/onboarding/role' };

  return { kind: 'redirect', href: '/(tabs)' };
}
