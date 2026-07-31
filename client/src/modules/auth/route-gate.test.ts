import { resolveGate, type GateInput } from './route-gate';

/** A fully onboarded, signed-in user. Each case overrides what it is about. */
const onboarded: GateInput = {
  status: 'authenticated',
  roleSelected: true,
  appConfigured: true,
  preferencesHydrated: true,
};

describe('resolveGate', () => {
  describe('before anything is known', () => {
    it('waits while the session is still hydrating', () => {
      // Not a redirect. Collapsing this into "/login" is the bug that shows a
      // returning user the login screen for one frame on every cold start.
      expect(resolveGate({ ...onboarded, status: 'unknown' })).toEqual({ kind: 'wait' });
    });

    it('waits on an unknown session even if onboarding looks incomplete', () => {
      expect(
        resolveGate({
          ...onboarded,
          status: 'unknown',
          roleSelected: false,
          appConfigured: false,
        }),
      ).toEqual({ kind: 'wait' });
    });
  });

  describe('signed out', () => {
    it('sends the user to login', () => {
      expect(resolveGate({ ...onboarded, status: 'unauthenticated' })).toEqual({
        kind: 'redirect',
        href: '/login',
      });
    });

    it('does not route into onboarding for someone with no session', () => {
      // Onboarding mutations are authenticated; arriving there signed out
      // would produce a 401 that trips the global sign-out fan-out.
      expect(
        resolveGate({
          ...onboarded,
          status: 'unauthenticated',
          roleSelected: false,
          appConfigured: false,
        }),
      ).toEqual({ kind: 'redirect', href: '/login' });
    });
  });

  describe('signed in, onboarding state not yet known', () => {
    it('waits while the role answer is still in flight', () => {
      // `me` has not resolved. Treating an unknown as "not selected" would
      // flash the role screen at a user who chose months ago.
      expect(resolveGate({ ...onboarded, roleSelected: null })).toEqual({ kind: 'wait' });
    });

    it('waits while local preferences are still being read', () => {
      // `appConfigured` defaults to false, so acting before hydration would
      // bounce every returning user through setup again.
      expect(
        resolveGate({ ...onboarded, appConfigured: false, preferencesHydrated: false }),
      ).toEqual({ kind: 'wait' });
    });
  });

  describe('onboarding', () => {
    it('asks for a role first', () => {
      expect(resolveGate({ ...onboarded, roleSelected: false, appConfigured: false })).toEqual({
        kind: 'redirect',
        href: '/onboarding/role',
      });
    });

    it('keeps asking for the role even when setup is already done', () => {
      // Reinstall case: the local flag is gone but the server still knows the
      // role — and the reverse, which this covers, must not skip the role.
      expect(resolveGate({ ...onboarded, roleSelected: false, appConfigured: true })).toEqual({
        kind: 'redirect',
        href: '/onboarding/role',
      });
    });

    it('moves to setup once the role is chosen', () => {
      expect(resolveGate({ ...onboarded, appConfigured: false })).toEqual({
        kind: 'redirect',
        href: '/onboarding/setup',
      });
    });

    it('skips the role step after a reinstall, because the server remembers', () => {
      // Local prefs are gone, the server column is not. Re-asking the role
      // would be asking a question already answered.
      expect(resolveGate({ ...onboarded, appConfigured: false })).toEqual({
        kind: 'redirect',
        href: '/onboarding/setup',
      });
    });
  });

  describe('fully onboarded', () => {
    it('goes to the tabs', () => {
      expect(resolveGate(onboarded)).toEqual({ kind: 'redirect', href: '/(tabs)' });
    });
  });
});
