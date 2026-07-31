import { resetAuthStore, useAuthStore } from './auth.store';

const read = () => useAuthStore.getState();

describe('auth.store', () => {
  beforeEach(resetAuthStore);

  it('starts in the unknown state so the gate holds rather than redirecting', () => {
    // The whole point of a third state: a cold start has not read SecureStore
    // yet, and treating that as "logged out" flashes the login screen at a
    // user who is signed in.
    expect(read().status).toBe('unknown');
    expect(read().userId).toBeNull();
    expect(read().token).toBeNull();
  });

  it('records the session on sign-in', () => {
    read().signedIn({ userId: 'user-1', token: 'token-1' });

    expect(read()).toMatchObject({
      status: 'authenticated',
      userId: 'user-1',
      token: 'token-1',
      endedReason: null,
    });
  });

  it('clears identity and credential together on sign-out', () => {
    read().signedIn({ userId: 'user-1', token: 'token-1' });
    read().signedOut();

    // A surviving token beside an unauthenticated status is the shape that
    // lets a request go out under a session the app has already discarded.
    expect(read()).toMatchObject({
      status: 'unauthenticated',
      userId: null,
      token: null,
      endedReason: null,
    });
  });

  it('carries the expiry reason so the login screen can explain the redirect', () => {
    read().signedIn({ userId: 'user-1', token: 'token-1' });
    read().signedOut('session-expired');

    expect(read().status).toBe('unauthenticated');
    expect(read().endedReason).toBe('session-expired');
  });

  it('drops the expiry reason once it has been shown', () => {
    read().signedOut('session-expired');
    read().clearEndedReason();

    expect(read().endedReason).toBeNull();
  });

  it('clears a stale expiry reason when a new session starts', () => {
    read().signedOut('session-expired');
    read().signedIn({ userId: 'user-2', token: 'token-2' });

    // Otherwise the banner reappears on the next sign-out that had no reason.
    expect(read().endedReason).toBeNull();
  });

  it('resolves hydration with no session without inventing a reason', () => {
    read().resolvedAnonymous();

    expect(read().status).toBe('unauthenticated');
    expect(read().endedReason).toBeNull();
  });
});
