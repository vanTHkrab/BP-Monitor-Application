/**
 * The general profile write.
 *
 * Three properties, all of them invisible from the screen that calls it.
 *
 * **The input passes through byte for byte.** `updateProfile`'s contract is
 * that an absent key leaves a column alone and an explicit `null` clears it —
 * see the header on `auth-api.ts`. A hook that helpfully stripped `null`s, or
 * spread a default over the input, would turn "clear my weight" into a no-op
 * with nothing on screen to show for it.
 *
 * **The response is cached, not refetched.** Nothing here invalidates `me`;
 * the mutation's own return value *is* the new profile. If `onSuccess` wrote
 * under the wrong key or wrote a patched copy instead, every screen reading
 * `useSession().user` would keep rendering the old name until something else
 * happened to refetch.
 *
 * **A failed write leaves the old profile alone.** There is no optimistic
 * update here on purpose, and adding one would show a saved name the server
 * rejected.
 */
const mockUpdateProfile = jest.fn();
jest.mock('../services/auth-api', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { User } from '../types';
import { USER } from './__fixtures__/session';
import { useUpdateProfile, type UpdateProfileInput } from './use-update-profile';

const UPDATED: User = { ...USER, firstname: 'สมชายใหม่', weight: 68 };

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderUpdate = () => renderHook(() => useUpdateProfile(), { wrapper });

async function submit(
  view: Awaited<ReturnType<typeof renderUpdate>>,
  input: UpdateProfileInput,
): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.updateProfile(input);
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateProfile.mockReset();
  mockUpdateProfile.mockResolvedValue(UPDATED);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('the request', () => {
  it('forwards the input object unchanged', async () => {
    const input: UpdateProfileInput = { firstname: 'สมชายใหม่', weight: 68 };

    const view = await renderUpdate();
    await submit(view, input);

    expect(mockUpdateProfile).toHaveBeenCalledWith(input);
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
  });

  it('keeps an explicit null, which is how a column is cleared', async () => {
    const view = await renderUpdate();
    await submit(view, { weight: null, congenitalDisease: null });

    // `toEqual` sees a dropped key and a `null` as different, which is the
    // whole point: the gateway writes a column only when the key is present
    // (`if (data.weight !== undefined)`), so a stripped `null` silently means
    // "leave it" and the user's cleared field comes straight back.
    expect(mockUpdateProfile.mock.calls[0][0]).toEqual({
      weight: null,
      congenitalDisease: null,
    });
  });

  it('sends an empty object as an empty object', async () => {
    const view = await renderUpdate();
    await submit(view, {});

    // No defaults spread in. A hook that filled in, say, the cached
    // `firstname` here would rewrite a field the caller did not touch —
    // and would do it with whatever the cache last happened to hold.
    expect(mockUpdateProfile.mock.calls[0][0]).toEqual({});
  });
});

describe('the cached user afterwards', () => {
  it('is the gateway response verbatim, under the key `useSession` reads', async () => {
    client.setQueryData(['me'], USER);

    const view = await renderUpdate();
    await submit(view, { firstname: 'สมชายใหม่' });

    // The server's copy, not a local merge: a field the gateway normalised on
    // the way in is what the rest of the app then renders.
    expect(client.getQueryData<User>(['me'])).toEqual(UPDATED);
    // Every field, not just the one the caller sent: the response replaces the
    // cached user wholesale, so a merge that kept the old `weight` would go
    // unnoticed by an assertion on `firstname` alone.
    expect(client.getQueryData<User>(['me'])?.weight).toBe(68);
  });

  it('populates `me` even when nothing had cached it yet', async () => {
    const view = await renderUpdate();
    await submit(view, { firstname: 'สมชายใหม่' });

    expect(client.getQueryData<User>(['me'])).toEqual(UPDATED);
  });

  it('does not mark `me` stale, so the write costs one round trip', async () => {
    client.setQueryData(['me'], USER);

    const view = await renderUpdate();
    await submit(view, { firstname: 'สมชายใหม่' });

    // The mutation already returned the answer — see the hook header. An
    // `invalidateQueries` here would be a second request for it.
    expect(client.getQueryState(['me'])?.isInvalidated).toBe(false);
  });

  it('leaves the previous profile in place when the write fails', async () => {
    client.setQueryData(['me'], USER);
    mockUpdateProfile.mockRejectedValue(
      new ApiError('[CONFLICT] เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว', { code: 'CONFLICT' }),
    );

    const view = await renderUpdate();
    await submit(view, { phone: '0899999999' });

    expect(client.getQueryData<User>(['me'])).toEqual(USER);
  });
});

describe('what the caller is told', () => {
  it('rejects with the transport error, unformatted', async () => {
    const cause = new ApiError('[CONFLICT] taken', { code: 'CONFLICT', httpStatus: 409 });
    mockUpdateProfile.mockRejectedValue(cause);

    const view = await renderUpdate();

    // No `formatAuthError` in this hook: `use-set-phone` and the profile
    // screen each map the code themselves, and swallowing it here would take
    // that choice away from both.
    expect(await submit(view, { phone: '0899999999' })).toBe(cause);
    // `waitFor`, not a bare read: TanStack notifies observers through its own
    // batching timer, so `mutation.error` lands a tick after `mutateAsync`
    // has already rejected. `result.current` is the last *committed* render.
    await waitFor(() => expect(view.result.current.error).toBe(cause));
  });

  it('drops the error on `reset`', async () => {
    mockUpdateProfile.mockRejectedValue(new Error('boom'));

    const view = await renderUpdate();
    await submit(view, { firstname: 'x' });
    await waitFor(() => expect(view.result.current.error).not.toBeNull());

    await act(async () => {
      view.result.current.reset();
    });

    await waitFor(() => expect(view.result.current.error).toBeNull());
    expect(view.result.current.isPending).toBe(false);
  });
});
