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
    it('waits while local preferences are still being read', () => {
      // First gate of all now. `appConfigured` defaults to false, so acting
      // before hydration would bounce every returning user through setup.
      expect(
        resolveGate({ ...onboarded, preferencesHydrated: false, appConfigured: false }),
      ).toEqual({ kind: 'wait' });
    });

    it('waits on unread preferences even for a fully signed-in user', () => {
      expect(resolveGate({ ...onboarded, preferencesHydrated: false })).toEqual({ kind: 'wait' });
    });

    it('waits while the session is still hydrating', () => {
      // Not a redirect. Collapsing this into "/login" is the bug that shows a
      // returning user the login screen for one frame on every cold start.
      expect(resolveGate({ ...onboarded, status: 'unknown' })).toEqual({ kind: 'wait' });
    });

    it('waits on an unknown session rather than guessing at the role step', () => {
      expect(
        resolveGate({ ...onboarded, status: 'unknown', roleSelected: false }),
      ).toEqual({ kind: 'wait' });
    });
  });

  /*
   * The ordering this file exists to pin, and the reason the rule is a pure
   * function rather than a `<Redirect>` buried in a screen.
   *
   * Display setup runs **before** login. The login and register screens are
   * themselves text, so gating the text-size control behind them asks someone
   * who cannot read small text to read a login form in order to reach the
   * control that fixes small text. And `setupCompleted` is a device-local
   * AsyncStorage flag rather than a server column, so making it wait on a
   * session was waiting on the wrong scope entirely.
   */
  describe('display setup, ahead of authentication', () => {
    it('routes a signed-out first-run user into setup, not login', () => {
      expect(
        resolveGate({ ...onboarded, status: 'unauthenticated', appConfigured: false }),
      ).toEqual({ kind: 'redirect', href: '/onboarding/setup' });
    });

    it('routes into setup even before the session has resolved', () => {
      // The whole point: this question does not depend on who is signed in, so
      // it must not wait for `status`.
      expect(resolveGate({ ...onboarded, status: 'unknown', appConfigured: false })).toEqual({
        kind: 'redirect',
        href: '/onboarding/setup',
      });
    });

    it('routes a signed-in user with no local flag back into setup', () => {
      // Reinstall case. The server remembers the role; the phone does not
      // remember the display settings, and that asymmetry is correct.
      expect(resolveGate({ ...onboarded, appConfigured: false })).toEqual({
        kind: 'redirect',
        href: '/onboarding/setup',
      });
    });

    it('takes precedence over the role step', () => {
      expect(
        resolveGate({ ...onboarded, appConfigured: false, roleSelected: false }),
      ).toEqual({ kind: 'redirect', href: '/onboarding/setup' });
    });
  });

  describe('signed out, once the device is configured', () => {
    it('sends the user to login', () => {
      expect(resolveGate({ ...onboarded, status: 'unauthenticated' })).toEqual({
        kind: 'redirect',
        href: '/login',
      });
    });

    it('does not route into the role step for someone with no session', () => {
      // Role selection is an authenticated mutation; arriving there signed out
      // would produce a 401 that trips the global sign-out fan-out.
      expect(
        resolveGate({ ...onboarded, status: 'unauthenticated', roleSelected: false }),
      ).toEqual({ kind: 'redirect', href: '/login' });
    });
  });

  describe('the role step, which stays after authentication', () => {
    it('waits while the role answer is still in flight', () => {
      // `me` has not resolved. Treating an unknown as "not selected" would
      // flash the role screen at a user who chose months ago.
      expect(resolveGate({ ...onboarded, roleSelected: null })).toEqual({ kind: 'wait' });
    });

    it('asks for a role once the device is set up and the user is signed in', () => {
      expect(resolveGate({ ...onboarded, roleSelected: false })).toEqual({
        kind: 'redirect',
        href: '/onboarding/role',
      });
    });

    it('does not wait on the role answer before the setup gate has run', () => {
      // `roleSelected: null` is a *later* gate now. A first-run user must not
      // be held on a spinner waiting for a query that needs a session they do
      // not have yet.
      expect(
        resolveGate({
          ...onboarded,
          status: 'unauthenticated',
          roleSelected: null,
          appConfigured: false,
        }),
      ).toEqual({ kind: 'redirect', href: '/onboarding/setup' });
    });
  });

  describe('fully onboarded', () => {
    it('goes to the tabs', () => {
      expect(resolveGate(onboarded)).toEqual({ kind: 'redirect', href: '/(tabs)' });
    });
  });
});
