/**
 * Login: what the caller gets, and in what order the session is bootstrapped.
 *
 * Three properties here are worth more than the happy path:
 *
 *  1. **The error reaches the caller unwrapped.** `mutateAsync` rejects, and
 *     what it rejects with has to still be the `ApiError` the transport threw
 *     — `code`, `httpStatus`, and `retryAfterSec` intact. A hook that caught
 *     and re-threw `new Error(message)` would keep every assertion about the
 *     banner green while turning the throttle countdown on the login screen
 *     into a generic failure, because `use-retry-countdown` is started from
 *     `error.retryAfterSec`.
 *  2. **The token is written before the store flips.** `signedIn` releases the
 *     route gate; a request that beats the token write goes out anonymous and
 *     trips the 401 fan-out that signs the user back out.
 *  3. **The `me` cache is repopulated before the store flips.** The onboarding
 *     gate reads `roleSelectedAt` off `me`, and Zustand notifies
 *     synchronously — see `__fixtures__/session.ts` for why end-state
 *     assertions cannot see this.
 */
// `@/stores`' barrel reaches the preferences store, which imports AsyncStorage
// at module scope. Nothing here reads it.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

/** Records the token-write / store-flip interleaving. */
const calls: string[] = [];

const mockLogin = jest.fn();
jest.mock('../services/auth-api', () => ({
  login: (...args: unknown[]) => mockLogin(...args),
}));

const mockSetAuthToken = jest.fn(async () => {
  calls.push('token');
});
jest.mock('@/services/auth-token', () => ({
  setAuthToken: (...args: unknown[]) => mockSetAuthToken(...(args as [])),
}));

const mockWriteLastLoginMethod = jest.fn(async () => {});
jest.mock('../lib/last-login-method', () => ({
  writeLastLoginMethod: (...args: unknown[]) => mockWriteLastLoginMethod(...(args as [])),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';
import { resetAuthStore, useAuthStore } from '@/stores';

import type { LoginInput } from '../types';
import { observeSignIn, OTHER_USER, USER } from './__fixtures__/session';
import { useLogin } from './use-login';

const INPUT: LoginInput = { phone: '0812345678', password: 'hunter2' };

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderLogin = () => renderHook(() => useLogin(), { wrapper });

async function attempt(
  view: Awaited<ReturnType<typeof renderLogin>>,
  input: LoginInput = INPUT,
): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.login(input);
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` does not drain a `mockResolvedValueOnce` queue; a leftover
  // is consumed by the next test and fails somewhere unrelated.
  mockLogin.mockReset();
  mockLogin.mockResolvedValue({ token: 'tok-1', user: USER });
  calls.length = 0;

  client = new QueryClient({
    // `gcTime: Infinity` rather than the `0` in `__test__/test-utils.tsx`:
    // this file seeds the cache and reads it back, and an entry with no
    // observer is collected the moment the timer fires.
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });

  // Zustand stores are module singletons; state written by one case survives
  // into the next.
  resetAuthStore();
  useAuthStore.setState({ endedReason: 'session-expired' });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('bootstrapping the session', () => {
  it('hands the caller the token and user the gateway returned', async () => {
    const view = await renderLogin();

    let payload: unknown;
    await act(async () => {
      payload = await view.result.current.login(INPUT);
    });

    expect(payload).toEqual({ token: 'tok-1', user: USER });
  });

  it('writes the token before the route gate can open', async () => {
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.status === 'authenticated') calls.push('signedIn');
    });

    const view = await renderLogin();
    await attempt(view);
    unsubscribe();

    // Reversed, the first authenticated request goes out with no
    // Authorization header and the 401 fan-out signs the user straight back
    // out — a login that looks like it worked for one frame.
    expect(calls).toEqual(['token', 'signedIn']);
  });

  it('has the new user in the `me` cache at the instant `status` flips', async () => {
    client.setQueryData(['me'], OTHER_USER);
    const { observation, stop } = observeSignIn(client);

    const view = await renderLogin();
    await attempt(view);
    stop();

    expect(observation.flipped).toBe(true);
    // Not `not.toBeNull()`: the previous account's `roleSelectedAt` is exactly
    // what the onboarding gate would misread, so the identity matters.
    expect(observation.meAtFlip).toEqual(USER);
  });

  it('has dropped the previous account cached queries by that same instant', async () => {
    client.setQueryData(['readings', OTHER_USER.id], [{ id: 1 }]);
    client.setQueryData(['security-overview'], { passkeyCount: 3 });
    const { observation, stop } = observeSignIn(client);

    const view = await renderLogin();
    await attempt(view);
    stop();

    expect(observation.strayKeysAtFlip).toBe(0);
    expect(client.getQueryData(['readings', OTHER_USER.id])).toBeUndefined();
    expect(client.getQueryData(['security-overview'])).toBeUndefined();
  });

  it('records the store fields the route gate reads', async () => {
    const view = await renderLogin();
    await attempt(view);

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      userId: USER.id,
      token: 'tok-1',
      // A stale "your session expired" banner over a fresh login reads as the
      // login having failed.
      endedReason: null,
    });
  });

  it('remembers password as the method this device last used', async () => {
    const view = await renderLogin();
    await attempt(view);

    expect(mockWriteLastLoginMethod).toHaveBeenCalledWith('password');
  });
});

describe('what the caller receives when the gateway refuses', () => {
  it('rejects with the transport error itself, not a copy', async () => {
    const cause = new ApiError('[TOO_MANY_REQUESTS] slow down', {
      code: 'TOO_MANY_REQUESTS',
      httpStatus: 429,
      retryAfterSec: 90,
    });
    mockLogin.mockRejectedValue(cause);

    const view = await renderLogin();
    const thrown = await attempt(view);

    // `toBe`, not `toBeInstanceOf`: re-throwing a reconstructed ApiError would
    // satisfy the weaker assertion while losing whichever field the
    // reconstruction forgot.
    expect(thrown).toBe(cause);
    expect(thrown).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      httpStatus: 429,
      retryAfterSec: 90,
    });
  });

  it('carries the retry window through to the countdown the screen starts', async () => {
    mockLogin.mockRejectedValue(
      new ApiError('slow down', { code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSec: 90 }),
    );

    const view = await renderLogin();
    await attempt(view);

    expect(view.result.current.error).toEqual({
      message: 'ลองเข้าระบบบ่อยเกินไป กรุณารออีก 2 นาที',
      field: null,
      retryAfterSec: 90,
    });
  });

  it('marks both fields on a rejected credential', async () => {
    mockLogin.mockRejectedValue(new ApiError('bad creds', { code: 'UNAUTHENTICATED' }));

    const view = await renderLogin();
    await attempt(view);

    expect(view.result.current.error).toEqual({
      message: 'เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง',
      field: 'both',
      retryAfterSec: null,
    });
  });

  it('names the reason for a suspended account rather than the login fallback', async () => {
    mockLogin.mockRejectedValue(new ApiError('[FORBIDDEN] disabled', { code: 'FORBIDDEN' }));

    const view = await renderLogin();
    await attempt(view);

    // The fallback would tell the user to check their password, which is wrong
    // advice — it will fail identically forever.
    expect(view.result.current.error?.message).toBe(
      'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
    );
  });

  it('falls back to Thai copy for an English transport failure', async () => {
    mockLogin.mockRejectedValue(new Error('Network request failed'));

    const view = await renderLogin();
    await attempt(view);

    expect(view.result.current.error?.message).toBe('เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง');
  });

  it('leaves the device signed out with no token written', async () => {
    mockLogin.mockRejectedValue(new ApiError('bad creds', { code: 'UNAUTHENTICATED' }));
    client.setQueryData(['me'], OTHER_USER);

    const view = await renderLogin();
    await attempt(view);

    expect(mockSetAuthToken).not.toHaveBeenCalled();
    expect(mockWriteLastLoginMethod).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).not.toBe('authenticated');
    // A failed login must not clear the cache either: the user may still be
    // signed in as someone else and simply mistyped on a re-auth prompt.
    expect(client.getQueryData(['me'])).toEqual(OTHER_USER);
  });

  it('clears a stale banner when the next attempt starts', async () => {
    mockLogin.mockRejectedValueOnce(new Error('boom'));

    const view = await renderLogin();
    await attempt(view);
    expect(view.result.current.error).not.toBeNull();

    await attempt(view);

    expect(view.result.current.error).toBeNull();
  });

  it('clears the banner when the user dismisses it', async () => {
    mockLogin.mockRejectedValue(new Error('boom'));

    const view = await renderLogin();
    await attempt(view);
    expect(view.result.current.error).not.toBeNull();

    await act(async () => {
      view.result.current.clearError();
    });

    expect(view.result.current.error).toBeNull();
    expect(view.result.current.isPending).toBe(false);
  });
});
