/**
 * The security hub's single read.
 *
 * A six-line `useQuery` wrapper, and exactly two things about it are
 * load-bearing.
 *
 * **The key.** `use-change-password.ts` invalidates `['security-overview']`
 * after a password change, because the gateway revokes every other session in
 * the same call and `activeSessionCount` is on this object. Nothing connects
 * the two files but that string, and a mismatch is silent: the screen keeps
 * showing a session count the server has already dropped to one, and the only
 * way back is to leave and return. Both files assert the literal key.
 *
 * **`overview` is `undefined` before the first answer, not a default object.**
 * The screen answers "is my account safe?", and a placeholder with
 * `passkeyCount: 0` and `hasPassword: false` renders as a specific, alarming
 * answer to that question while the request is still in flight — which is the
 * exact failure the hook header calls a "half-loaded answer".
 */
const mockFetchSecurityOverview = jest.fn();
jest.mock('../services/security-api', () => ({
  fetchSecurityOverview: (...args: unknown[]) => mockFetchSecurityOverview(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { SecurityOverview } from '../types';
import { useSecurityOverview } from './use-security-overview';

const OVERVIEW: SecurityOverview = {
  lastLoginMethod: 'passkey',
  passkeyCount: 2,
  activeSessionCount: 3,
  hasPassword: true,
  hasGoogleAccount: false,
  emailVerified: true,
  passkeySupported: true,
};

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderOverview = () => renderHook(() => useSecurityOverview(), { wrapper });

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchSecurityOverview.mockReset();
  mockFetchSecurityOverview.mockResolvedValue(OVERVIEW);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('the read', () => {
  it('files the answer under the key `useChangePassword` invalidates', async () => {
    const view = await renderOverview();
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));

    // The literal key, spelled out. See the file header: this string is the
    // only thing joining the two files.
    expect(client.getQueryData<SecurityOverview>(['security-overview'])).toEqual(OVERVIEW);
    expect(view.result.current.overview).toEqual(OVERVIEW);
  });

  it('asks for nothing — the account is the session', async () => {
    const view = await renderOverview();
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));

    // `queryFn: securityApi.fetchSecurityOverview` is passed by reference, so
    // TanStack hands it its own query context. Nothing from it may be
    // forwarded as an argument that could scope the answer to someone else.
    expect(mockFetchSecurityOverview).toHaveBeenCalledTimes(1);
    expect(mockFetchSecurityOverview.mock.calls[0].length).toBe(1);
  });

  it('leaves `overview` undefined while the request is in flight', async () => {
    // Held open rather than resolved, so "still loading" is true by
    // construction rather than by winning a race.
    mockFetchSecurityOverview.mockImplementation(() => new Promise(() => {}));

    const view = await renderOverview();

    // No placeholder. Every field the screen reads is optional-chained off
    // this, and a zeroed default would render "ไม่มีรหัสผ่าน" at someone
    // who has one.
    expect(view.result.current.overview).toBeUndefined();
    expect(view.result.current.isLoading).toBe(true);
    expect(view.result.current.error).toBeNull();
  });

  it('surfaces the transport error unwrapped, with no partial data beside it', async () => {
    const cause = new ApiError('[UNAUTHENTICATED] no', {
      code: 'UNAUTHENTICATED',
      httpStatus: 401,
    });
    mockFetchSecurityOverview.mockRejectedValue(cause);

    const view = await renderOverview();
    await waitFor(() => expect(view.result.current.error).toBe(cause));

    // A failed load must not leave anything the screen could read as an
    // answer — `undefined` is what makes the error state reachable.
    expect(view.result.current.overview).toBeUndefined();
  });

  it('refetches on demand and hands back the newer answer', async () => {
    const view = await renderOverview();
    await waitFor(() => expect(view.result.current.overview).toEqual(OVERVIEW));

    // The security screen calls this after registering or deleting a
    // passkey, so the count has to move without a remount.
    const after: SecurityOverview = { ...OVERVIEW, passkeyCount: 3 };
    mockFetchSecurityOverview.mockResolvedValue(after);

    await view.result.current.refetch();

    await waitFor(() => expect(view.result.current.overview).toEqual(after));
    expect(mockFetchSecurityOverview).toHaveBeenCalledTimes(2);
  });
});
