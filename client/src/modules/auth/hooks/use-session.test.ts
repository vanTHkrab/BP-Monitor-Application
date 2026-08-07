/**
 * The read-only session view every screen uses.
 *
 * One line here is load-bearing well out of proportion to its size:
 *
 *     enabled: isAuthenticated
 *
 * Without it, `useSession` fires `me` on every mount regardless of whether
 * there is a token. The gateway answers `UNAUTHENTICATED`, and the transport
 * turns that into `fireUnauthenticated()` — the global 401 fan-out that signs
 * the app out. So a hook whose whole job is *reading* state would be the thing
 * destroying it, and the damage is worst exactly where it is least visible:
 * during `status === 'unknown'`, the pre-hydration window on a cold start when
 * the token is still coming out of SecureStore. A user who has been signed in
 * for months gets bounced to the login screen because a screen rendered a
 * fraction of a second early.
 *
 * That is why the assertions below are mostly negative — `fetchMe` was *not*
 * called — and why `'unknown'` gets its own case rather than being folded in
 * with `'unauthenticated'`. They are two different bugs: the second is a
 * wasted request, the first is a logout.
 *
 * `user` coming from the query rather than the store is the other property
 * worth pinning. The store holds identity for routing; the query holds the
 * profile. A second copy in the store would drift on every `updateProfile`,
 * and this hook is where that drift would become visible.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

const mockFetchMe = jest.fn();
jest.mock('../services/auth-api', () => ({
  fetchMe: (...args: unknown[]) => mockFetchMe(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';
import { resetAuthStore, useAuthStore } from '@/stores';

import { OTHER_USER, USER } from './__fixtures__/session';
import { useSession } from './use-session';

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderSession = () => renderHook(() => useSession(), { wrapper });

const signIn = () => useAuthStore.getState().signedIn({ userId: USER.id, token: 'tok-1' });

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchMe.mockReset();
  mockFetchMe.mockResolvedValue(USER);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  // `resetAuthStore` restores `status: 'unknown'` — the pre-hydration state,
  // and the one the gate below exists for.
  resetAuthStore();
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('the query gate', () => {
  it('sends no request during the pre-hydration window', async () => {
    const view = await renderSession();

    // `status === 'unknown'` means "the token is still being read out of
    // SecureStore". A `me` request here 401s against a session that is about
    // to exist, and the fan-out signs out a user who never left.
    expect(useAuthStore.getState().status).toBe('unknown');
    expect(mockFetchMe).not.toHaveBeenCalled();
    expect(view.result.current.isAuthenticated).toBe(false);
  });

  it('sends no request once hydration has found no session', async () => {
    await act(async () => {
      useAuthStore.getState().resolvedAnonymous();
    });

    await renderSession();

    // Milder than the case above — nobody is signed out — but it is still a
    // guaranteed 401 on every mount of every screen on the login stack.
    expect(mockFetchMe).not.toHaveBeenCalled();
  });

  it('fetches once there is a session', async () => {
    await act(async () => signIn());

    const view = await renderSession();
    await waitFor(() => expect(view.result.current.user).toEqual(USER));

    expect(mockFetchMe).toHaveBeenCalledTimes(1);
  });

  it('starts fetching when a sign-in happens under a mounted screen', async () => {
    const view = await renderSession();
    expect(mockFetchMe).not.toHaveBeenCalled();

    await act(async () => signIn());

    // The gate has to be reactive, not read once at mount: the login screen is
    // mounted while `signedIn` fires, and a gate frozen at `false` would leave
    // every screen with `user: null` until something remounted.
    await waitFor(() => expect(view.result.current.user).toEqual(USER));
  });
});

describe('what a screen reads', () => {
  it('reports the store fields verbatim', async () => {
    await act(async () => signIn());

    const view = await renderSession();

    expect(view.result.current.status).toBe('authenticated');
    expect(view.result.current.userId).toBe(USER.id);
    expect(view.result.current.isAuthenticated).toBe(true);
  });

  it('derives `isAuthenticated` from `authenticated` alone, not from truthiness', async () => {
    const view = await renderSession();

    // `'unknown'` is a non-empty string. A `Boolean(status)` check would make
    // the pre-hydration window read as signed in and open every route gate on
    // a cold start.
    expect(view.result.current.status).toBe('unknown');
    expect(view.result.current.isAuthenticated).toBe(false);
  });

  it('takes the profile from the `me` query, not from the store', async () => {
    // The store is signed in as USER; the query answers with OTHER_USER. The
    // disagreement is the instrument — whichever identity `user` reports names
    // the source it read.
    //
    // An earlier version seeded the cache with `setQueryData` instead, and
    // that is a race rather than a test: the query is *enabled* here, so
    // `fetchMe` resolves and overwrites the seed. It passed locally and failed
    // under the full parallel suite.
    await act(async () => signIn());
    mockFetchMe.mockResolvedValue(OTHER_USER);

    const view = await renderSession();
    await waitFor(() => expect(view.result.current.user).toEqual(OTHER_USER));

    // The store knows only the id, and it is still USER's. Everything else has
    // exactly one home, which is what keeps a successful `updateProfile` from
    // leaving a stale name rendered somewhere else.
    expect(view.result.current.userId).toBe(USER.id);
  });

  it('gives `null` rather than `undefined` before the profile arrives', async () => {
    await act(async () => signIn());
    let release = (_: unknown) => {};
    mockFetchMe.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    const view = await renderSession();

    // Screens branch on `user &&`; `undefined` and `null` behave alike there,
    // but the declared return type is `User | null` and a leaked `undefined`
    // would break a caller destructuring with a default.
    expect(view.result.current.user).toBeNull();
    expect(view.result.current.isLoadingUser).toBe(true);

    await act(async () => {
      release(USER);
    });
    await waitFor(() => expect(view.result.current.isLoadingUser).toBe(false));
  });

  it('reports a failed profile fetch as no user, not a stale one', async () => {
    await act(async () => signIn());
    mockFetchMe.mockRejectedValue(new ApiError('[FORBIDDEN] no', { code: 'FORBIDDEN' }));

    const view = await renderSession();
    await waitFor(() => expect(view.result.current.isLoadingUser).toBe(false));

    expect(view.result.current.user).toBeNull();
    // The session itself is untouched — this hook reads, it never signs out.
    // That decision belongs to the transport's 401 fan-out.
    expect(view.result.current.isAuthenticated).toBe(true);
    expect(useAuthStore.getState().status).toBe('authenticated');
  });
});
