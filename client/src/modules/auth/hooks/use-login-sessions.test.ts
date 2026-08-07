/**
 * The signed-in-devices screen, and "log out everywhere else".
 *
 * The push-token argument is the whole reason this file exists. It appears in
 * two calls in this codebase with **opposite** meanings: `logout(pushToken)`
 * means "delete this installation's subscription", while
 * `logoutAllDevices(pushToken)` means "keep this one and delete every other".
 * Same name, same type, inverted sense. Omitting it here does not fail
 * anything visible — the devices are still revoked — it just silently
 * unsubscribes the phone in the user's hand from its own critical alerts.
 * Nothing on screen shows it and no request errors.
 *
 * The other property is negative and equally invisible: this action must not
 * disturb *this* device's session. A "log out everywhere" that also signs you
 * out locally reads as the app crashing rather than as the security action it
 * is, so the store and the `me` cache are asserted unchanged.
 *
 * Invalidation is asserted through `getQueryState().isInvalidated` rather than
 * a spy on `invalidateQueries`: the spy proves a call was made, the cache
 * state proves the entry the screen actually reads was marked stale.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

const mockFetchLoginSessions = jest.fn();
const mockLogoutAllDevices = jest.fn();
jest.mock('../services/auth-api', () => ({
  fetchLoginSessions: (...args: unknown[]) => mockFetchLoginSessions(...args),
  logoutAllDevices: (...args: unknown[]) => mockLogoutAllDevices(...args),
}));

const mockGetRegisteredPushToken = jest.fn();
jest.mock('@/modules/notifications/services/push-registration', () => ({
  getRegisteredPushToken: () => mockGetRegisteredPushToken(),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';
import { resetAuthStore, useAuthStore } from '@/stores';

import type { LoginSession } from '../types';
import { USER } from './__fixtures__/session';
import { useLoginSessions, useLogoutAllDevices } from './use-login-sessions';

const PUSH_TOKEN = 'ExponentPushToken[abc123]';

const session = (id: string, over: Partial<LoginSession> = {}): LoginSession => ({
  id,
  deviceLabel: 'Android App',
  isActive: true,
  lastActiveAt: new Date('2026-02-01T09:00:00.000Z'),
  createdAt: new Date('2026-01-01T09:00:00.000Z'),
  ...over,
});

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const stateOf = (key: string) => client.getQueryState([key]);

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchLoginSessions.mockReset();
  mockLogoutAllDevices.mockReset();
  mockGetRegisteredPushToken.mockReset();

  mockFetchLoginSessions.mockResolvedValue([]);
  mockLogoutAllDevices.mockResolvedValue(undefined);
  mockGetRegisteredPushToken.mockResolvedValue(PUSH_TOKEN);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  resetAuthStore();
  useAuthStore.getState().signedIn({ userId: USER.id, token: 'tok-1' });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('useLoginSessions', () => {
  it('files the list under the key the mutation invalidates', async () => {
    mockFetchLoginSessions.mockResolvedValue([session('s1')]);

    const view = await renderHook(() => useLoginSessions(), { wrapper });
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));

    // A mismatch between this key and `useLogoutAllDevices`'s invalidation
    // leaves revoked devices on screen until the user leaves and comes back.
    expect(client.getQueryData(['login-sessions'])).toEqual([session('s1')]);
    expect(view.result.current.sessions).toEqual([session('s1')]);
  });

  it('gives the screen an empty list rather than undefined before the first load', async () => {
    // Held open rather than resolved, so "still loading" is true by
    // construction. The same assertion against a `mockResolvedValue` is a race
    // the query can win under load — see the note on the sibling test in
    // `use-passkeys.test.ts`.
    mockFetchLoginSessions.mockImplementation(() => new Promise(() => {}));

    const view = await renderHook(() => useLoginSessions(), { wrapper });

    // The screen maps over this directly; `undefined` is a crash, not a
    // spinner.
    expect(view.result.current.sessions).toEqual([]);
    expect(view.result.current.isLoading).toBe(true);
  });

  it('surfaces the transport error unwrapped so the screen can tell 403 from offline', async () => {
    const cause = new ApiError('[FORBIDDEN] no', { code: 'FORBIDDEN', httpStatus: 403 });
    mockFetchLoginSessions.mockRejectedValue(cause);

    const view = await renderHook(() => useLoginSessions(), { wrapper });
    await waitFor(() => expect(view.result.current.error).not.toBeNull());

    expect(view.result.current.error).toBe(cause);
    expect(view.result.current.error).toMatchObject({ code: 'FORBIDDEN', httpStatus: 403 });
  });

  it('keeps the last good list visible while refetching', async () => {
    mockFetchLoginSessions.mockResolvedValue([session('s1')]);
    const view = await renderHook(() => useLoginSessions(), { wrapper });
    await waitFor(() => expect(view.result.current.sessions).toHaveLength(1));

    mockFetchLoginSessions.mockResolvedValue([session('s1'), session('s2')]);
    await act(async () => {
      await view.result.current.refetch();
    });

    // `waitFor`, not a bare assertion: `refetch()`'s promise resolves when the
    // query settles, which is one notify tick before the hook re-renders with
    // the new data. Reading `result.current` immediately gets the pre-refetch
    // list and looks like the pull-to-refresh silently doing nothing.
    await waitFor(() =>
      expect(view.result.current.sessions).toEqual([session('s1'), session('s2')]),
    );
  });
});

describe('useLogoutAllDevices', () => {
  it('passes this installation token so the gateway keeps its subscription', async () => {
    const view = await renderHook(() => useLogoutAllDevices(), { wrapper });

    await act(async () => {
      await view.result.current.logoutAllDevices();
    });

    // The inversion described at the top of this file. Dropping this argument
    // leaves the phone signed in and silently no longer notified.
    expect(mockLogoutAllDevices).toHaveBeenCalledWith(PUSH_TOKEN);
  });

  it('still revokes the other devices when this one never registered a token', async () => {
    // Expo Go on Android can never obtain one.
    mockGetRegisteredPushToken.mockResolvedValue(null);

    const view = await renderHook(() => useLogoutAllDevices(), { wrapper });
    await act(async () => {
      await view.result.current.logoutAllDevices();
    });

    // `undefined`, not `null`: `null` would serialise as a GraphQL variable
    // and the gateway would read it as "keep no installation".
    expect(mockLogoutAllDevices).toHaveBeenCalledWith(undefined);
  });

  it('marks both the list and the hub count stale', async () => {
    client.setQueryData(['login-sessions'], [session('s1'), session('s2')]);
    client.setQueryData(['security-overview'], { activeSessionCount: 2 });

    const view = await renderHook(() => useLogoutAllDevices(), { wrapper });
    await act(async () => {
      await view.result.current.logoutAllDevices();
    });

    // The hub one matters as much as the list: a "2 devices" badge one screen
    // away from a one-row list is what makes people distrust a security page.
    expect(stateOf('login-sessions')?.isInvalidated).toBe(true);
    expect(stateOf('security-overview')?.isInvalidated).toBe(true);
  });

  it('leaves this device signed in', async () => {
    client.setQueryData(['me'], USER);

    const view = await renderHook(() => useLogoutAllDevices(), { wrapper });
    await act(async () => {
      await view.result.current.logoutAllDevices();
    });

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      userId: USER.id,
      token: 'tok-1',
    });
    // Not cleared, and not even invalidated — nothing about this account
    // changed, and a refetch here would be a request nobody asked for.
    expect(client.getQueryData(['me'])).toEqual(USER);
    expect(stateOf('me')?.isInvalidated).toBe(false);
  });

  it('invalidates nothing when the gateway refuses', async () => {
    client.setQueryData(['login-sessions'], [session('s1')]);
    client.setQueryData(['security-overview'], { activeSessionCount: 1 });
    const cause = new ApiError('[UNAUTHENTICATED] no', { code: 'UNAUTHENTICATED' });
    mockLogoutAllDevices.mockRejectedValue(cause);

    const view = await renderHook(() => useLogoutAllDevices(), { wrapper });
    let thrown: unknown = null;
    await act(async () => {
      try {
        await view.result.current.logoutAllDevices();
      } catch (error) {
        thrown = error;
      }
    });

    // This hook has no error state of its own, so the rejection *is* the
    // caller's only signal — it has to arrive with `code` intact.
    expect(thrown).toBe(cause);
    expect(stateOf('login-sessions')?.isInvalidated).toBe(false);
    expect(stateOf('security-overview')?.isInvalidated).toBe(false);
    expect(view.result.current.isPending).toBe(false);
  });
});
