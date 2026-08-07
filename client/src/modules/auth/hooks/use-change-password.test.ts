/**
 * Changing the password from the security screen.
 *
 * The header of the hook makes one claim that is invisible from the screen:
 * the gateway revokes every *other* session as part of the same call, so the
 * two cached answers that describe those sessions have to be marked stale.
 * Nothing on this device shows the difference — the user stays signed in
 * either way — which is exactly why it is asserted here rather than trusted.
 *
 * The negative half matters more than the positive one. This device's session
 * survives, so `['me']` must **not** be disturbed: invalidating it would put
 * a profile refetch behind a password change, and clearing it would sign the
 * user out of the screen they are standing on.
 *
 * Invalidation is read through `getQueryState().isInvalidated` rather than a
 * spy, for the reason `use-login-sessions.test.ts` gives: the spy proves a
 * call happened, the cache state proves the entry the screen reads was the
 * one it reached.
 */
const mockChangePassword = jest.fn();
jest.mock('../services/auth-api', () => ({
  changePassword: (...args: unknown[]) => mockChangePassword(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import { USER } from './__fixtures__/session';
import { useChangePassword } from './use-change-password';

const INPUT = { currentPassword: 'old-pass-1', newPassword: 'new-pass-2' };

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderChangePassword = () => renderHook(() => useChangePassword(), { wrapper });

const invalidated = (key: unknown[]) => client.getQueryState(key)?.isInvalidated;

async function submit(view: Awaited<ReturnType<typeof renderChangePassword>>): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.changePassword(INPUT);
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` clears the call log but not implementations, and leaves a
  // `mockRejectedValueOnce` queue in place for the next test to consume.
  mockChangePassword.mockReset();
  mockChangePassword.mockResolvedValue(undefined);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  // Seeded so `isInvalidated` has an entry to be true of. `gcTime: Infinity`
  // keeps them alive with no observer attached.
  client.setQueryData(['login-sessions'], []);
  client.setQueryData(['security-overview'], { passkeyCount: 0 });
  client.setQueryData(['me'], USER);
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('the request', () => {
  it('sends both passwords and nothing else, once', async () => {
    const view = await renderChangePassword();
    await submit(view);

    // `toHaveBeenCalledWith` on the whole object: the gateway reads this as
    // an input type, and an extra key here is a field of the account this
    // screen has no business writing.
    expect(mockChangePassword).toHaveBeenCalledWith(INPUT);
    expect(mockChangePassword).toHaveBeenCalledTimes(1);
  });
});

describe('the caches afterwards', () => {
  it('marks both lists that describe the revoked sessions stale', async () => {
    const view = await renderChangePassword();
    await submit(view);

    // Leaving either one alone tells the user their other phone is still
    // signed in after the gateway has already cut it off.
    expect(invalidated(['login-sessions'])).toBe(true);
    expect(invalidated(['security-overview'])).toBe(true);
  });

  it('leaves this device own session and profile untouched', async () => {
    const view = await renderChangePassword();
    await submit(view);

    // This device stays signed in — see the note on `changePassword` in
    // `auth-api.ts`. A refetch of `me` here would be a round trip for an
    // answer that cannot have changed, and clearing it would empty the screen
    // the user is standing on.
    expect(invalidated(['me'])).toBe(false);
    expect(client.getQueryData(['me'])).toEqual(USER);
  });

  it('invalidates nothing when the gateway refuses the current password', async () => {
    mockChangePassword.mockRejectedValue(
      new ApiError('[UNAUTHENTICATED] รหัสผ่านเดิมไม่ถูกต้อง', { code: 'UNAUTHENTICATED' }),
    );

    const view = await renderChangePassword();
    await submit(view);

    // Nothing was revoked, so nothing is stale. Invalidating on failure would
    // put two refetches behind every mistyped password.
    expect(invalidated(['login-sessions'])).toBe(false);
    expect(invalidated(['security-overview'])).toBe(false);
  });
});

describe('what the caller is told', () => {
  it('rejects with the transport error, code intact', async () => {
    const cause = new ApiError('[UNAUTHENTICATED] wrong', {
      code: 'UNAUTHENTICATED',
      httpStatus: 401,
    });
    mockChangePassword.mockRejectedValue(cause);

    const view = await renderChangePassword();

    // Unwrapped: the screen tells "รหัสผ่านเดิมไม่ถูกต้อง" from "offline" by
    // this code, and there is no `formatAuthError` in this hook to do it.
    expect(await submit(view)).toBe(cause);
  });

  it('holds the failure on `error` and drops it on `reset`', async () => {
    const cause = new ApiError('[BAD_USER_INPUT] สั้นเกินไป', { code: 'BAD_USER_INPUT' });
    mockChangePassword.mockRejectedValue(cause);

    const view = await renderChangePassword();
    await submit(view);
    // `waitFor`, not a bare read: TanStack notifies observers through its own
    // batching timer, so `mutation.error` lands a tick after `mutateAsync`
    // has already rejected. `result.current` is the last *committed* render.
    await waitFor(() => expect(view.result.current.error).toBe(cause));

    await act(async () => {
      view.result.current.reset();
    });

    // The screen's banner is driven by this. Without `reset` it survives the
    // user dismissing the sheet and reappears the next time it opens.
    await waitFor(() => expect(view.result.current.error).toBeNull());
    expect(view.result.current.isPending).toBe(false);
  });
});
