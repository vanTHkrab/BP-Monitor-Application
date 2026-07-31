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
 *  - **Onboarding is ordered and resumable.** Role comes before app setup,
 *    and each step is gated on its own signal, so someone who force-quits
 *    halfway resumes where they stopped instead of starting over or
 *    skipping ahead.
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
  if (status === 'unknown') return { kind: 'wait' };
  if (status === 'unauthenticated') return { kind: 'redirect', href: '/login' };

  // Signed in from here on. Both onboarding signals must be known before
  // routing, or the first frame sends the user somewhere they do not belong.
  if (roleSelected === null || !preferencesHydrated) return { kind: 'wait' };

  if (!roleSelected) return { kind: 'redirect', href: '/onboarding/role' };
  if (!appConfigured) return { kind: 'redirect', href: '/onboarding/setup' };

  return { kind: 'redirect', href: '/(tabs)' };
}
