/**
 * "ลบข้อมูลทั้งหมด" — the readings, posts, and likes, not the account.
 *
 * The hook's header argues for `queryClient.clear()` over a list of keys,
 * because enumerating them means a future feature's cache is the one that gets
 * missed. That argument is only worth anything if `clear()` really does reach
 * a key nobody thought about, so the test seeds one the hook has never heard
 * of and checks it is gone too.
 *
 * The other half is that it must not run on failure. A cleared cache after a
 * refused request empties every list on screen and reads to the user as though
 * the destructive action they were warned about went through.
 */
const mockDeleteMyData = jest.fn();
jest.mock('../services/auth-api', () => ({
  deleteMyData: (...args: unknown[]) => mockDeleteMyData(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import { USER } from './__fixtures__/session';
import { useDeleteMyData } from './use-delete-my-data';

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderDelete = () => renderHook(() => useDeleteMyData(), { wrapper });

const cachedKeys = () =>
  client
    .getQueryCache()
    .getAll()
    .map((entry) => entry.queryKey);

async function submit(view: Awaited<ReturnType<typeof renderDelete>>): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.deleteMyData();
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteMyData.mockReset();
  mockDeleteMyData.mockResolvedValue(undefined);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  client.setQueryData(['me'], USER);
  client.setQueryData(['readings', USER.id], [{ id: 1 }]);
  client.setQueryData(['posts', 'general'], [{ id: 1 }]);
  // The key the hook has never heard of — the whole case for `clear()`.
  client.setQueryData(['some-future-feature', 'nested', 7], { rows: 1 });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('the request', () => {
  it('takes no arguments — the account is the session, not a parameter', async () => {
    const view = await renderDelete();
    await submit(view);

    // `mutationFn: authApi.deleteMyData` is passed by reference, so TanStack
    // hands it the mutation variable. Nothing may be forwarded to a call that
    // decides whose data to delete from the session alone.
    expect(mockDeleteMyData).toHaveBeenCalledTimes(1);
    expect(mockDeleteMyData.mock.calls[0][0]).toBeUndefined();
  });
});

describe('the cache afterwards', () => {
  it('empties every entry, including one the hook was never told about', async () => {
    const view = await renderDelete();
    await submit(view);

    expect(cachedKeys()).toEqual([]);
    // Named individually as well, because an empty list is also what a
    // never-seeded cache looks like if the `beforeEach` above ever drifts.
    expect(client.getQueryData(['readings', USER.id])).toBeUndefined();
    expect(client.getQueryData(['some-future-feature', 'nested', 7])).toBeUndefined();
  });

  it('takes the profile with it, so nothing renders against deleted rows', async () => {
    const view = await renderDelete();
    await submit(view);

    // `me` is not spared. It is refetched by `useSession` the moment a screen
    // observes it, and the account itself survives — see the hook header.
    expect(client.getQueryData(['me'])).toBeUndefined();
  });

  it('keeps everything when the gateway refuses', async () => {
    mockDeleteMyData.mockRejectedValue(new ApiError('[FORBIDDEN] no', { code: 'FORBIDDEN' }));

    const view = await renderDelete();
    await submit(view);

    // A cleared cache here would blank every list in the app for a request
    // that did nothing — indistinguishable, on screen, from the deletion
    // having succeeded.
    expect(client.getQueryData(['me'])).toEqual(USER);
    expect(client.getQueryData(['readings', USER.id])).toEqual([{ id: 1 }]);
  });
});

describe('what the caller is told', () => {
  it('rejects with the transport error so the screen can keep the sheet open', async () => {
    const cause = new ApiError('[FORBIDDEN] no', { code: 'FORBIDDEN', httpStatus: 403 });
    mockDeleteMyData.mockRejectedValue(cause);

    const view = await renderDelete();

    expect(await submit(view)).toBe(cause);
    // `waitFor`, not a bare read: TanStack notifies observers through its own
    // batching timer, so `mutation.error` lands a tick after `mutateAsync`
    // has already rejected. `result.current` is the last *committed* render.
    await waitFor(() => expect(view.result.current.error).toBe(cause));
  });
});
