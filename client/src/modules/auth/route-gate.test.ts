import { resolveGate } from './route-gate';

describe('resolveGate', () => {
  it('waits while the session is still hydrating', () => {
    // Not a redirect. Collapsing this into "/login" is the bug that shows a
    // returning user the login screen for one frame on every cold start.
    expect(resolveGate('unknown')).toEqual({ kind: 'wait' });
  });

  it('sends an authenticated user to the tabs', () => {
    expect(resolveGate('authenticated')).toEqual({ kind: 'redirect', href: '/(tabs)' });
  });

  it('sends everyone else to login', () => {
    expect(resolveGate('unauthenticated')).toEqual({ kind: 'redirect', href: '/login' });
  });
});
