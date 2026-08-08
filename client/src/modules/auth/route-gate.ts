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

export type GateHref = '/(tabs)' | '/login' | '/onboarding/role' | '/onboarding/setup';

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
  /** Local flag. False means first-run setup is still due on this device. */
  appConfigured: boolean;
  /** False until AsyncStorage has been read back. */
  preferencesHydrated: boolean;
};

export function resolveGate({
  status,
  roleSelected,
  appConfigured,
  preferencesHydrated,
}: GateInput): GateDestination {
  // Device-local, and answered first — see the header. Nothing about this
  // question involves the session, so it does not wait for one.
  if (!preferencesHydrated) return { kind: 'wait' };
  if (!appConfigured) return { kind: 'redirect', href: '/onboarding/setup' };

  if (status === 'unknown') return { kind: 'wait' };
  if (status === 'unauthenticated') return { kind: 'redirect', href: '/login' };

  // Signed in from here on. `roleSelected` writes to the server, so it needs a
  // session — and `null` means `me` is still in flight, which is not the same
  // as "not selected". Treating it as the latter flashes the role screen at
  // someone who chose months ago.
  if (roleSelected === null) return { kind: 'wait' };
  if (!roleSelected) return { kind: 'redirect', href: '/onboarding/role' };

  return { kind: 'redirect', href: '/(tabs)' };
}
