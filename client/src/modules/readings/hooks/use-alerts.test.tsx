/**
 * Alerts: the cache key, and the optimistic write that has to be undone.
 *
 * The only readings data with no SQLite mirror, so this TanStack cache is the
 * *only* copy — a rollback that misses leaves a badge showing a state no
 * server ever agreed to, and nothing later corrects it.
 *
 * Two properties matter more than the rest and neither is visible in a type:
 *
 *   - The key is per subject. A bare `['alerts']` would serve the caregiver's
 *     own alerts from cache the moment they entered a patient and then
 *     overwrite them with the patient's, so the badge would show whichever
 *     request landed last. Half these tests exist to hold that.
 *   - The optimistic patch and its rollback both address one subject's entry.
 *     A rollback under the wrong key restores the wrong person's list.
 *
 * The query client is built per test with retries off. A retrying query turns
 * an asserted error state into a test that waits out the backoff, and a
 * client shared between tests is a suite that passes only in one order.
 */
jest.mock('@/modules/auth', () => require('./__fixtures__/identity').authModuleMock());

jest.mock('@/modules/caregivers', () => require('./__fixtures__/identity').caregiversModuleMock());

const mockFetchAlerts = jest.fn();
const mockMarkAlertRead = jest.fn();
const mockMarkAllAlertsRead = jest.fn();
jest.mock('../services/alerts-api', () => ({
  fetchAlerts: (...a: unknown[]) => mockFetchAlerts(...a),
  markAlertRead: (...a: unknown[]) => mockMarkAlertRead(...a),
  markAllAlertsRead: (...a: unknown[]) => mockMarkAllAlertsRead(...a),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { Alert } from '../types';
import {
  actAsCaregiverViewingPatient,
  actAsSignedOut,
  identity,
  PATIENT,
  resetIdentity,
  SELF,
} from './__fixtures__/identity';
import { useAlerts, useMarkAlertRead, useMarkAllAlertsRead } from './use-alerts';

const alert = (id: number, isRead = false): Alert => ({
  id,
  readingId: id * 10,
  message: `ค่าความดันสูงผิดปกติ (${id})`,
  level: 'critical',
  isRead,
  isAboutSomeoneElse: false,
  createdAt: new Date('2026-02-01T09:00:00.000Z'),
});

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const keyFor = (subjectId: string) => ['alerts', subjectId];

const cached = (subjectId: string) => client.getQueryData<Alert[]>(keyFor(subjectId));

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` does not drain a `mockResolvedValueOnce` queue; a
  // leftover is consumed by the next test and fails somewhere unrelated.
  mockFetchAlerts.mockReset();
  mockMarkAlertRead.mockReset();
  mockMarkAllAlertsRead.mockReset();

  mockFetchAlerts.mockResolvedValue([]);
  mockMarkAlertRead.mockResolvedValue(true);
  mockMarkAllAlertsRead.mockResolvedValue(true);

  client = new QueryClient({
    // `gcTime: Infinity`, unlike the `0` in `__test__/test-utils.tsx`. Half
    // this file seeds the cache with `setQueryData` and then reads it back,
    // and an entry with no observer is collected the moment the timer fires
    // — every `getQueryData` came back `undefined` and read as a bug in the
    // optimistic update. A fresh client per test is what makes keeping the
    // data safe here; `Infinity` also schedules no timer to leak into the
    // next file.
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  resetIdentity();
});

afterEach(() => {
  // A pending mutation or an in-flight query outliving the test is how a
  // failure surfaces two files later with a stack pointing at innocent code.
  client.cancelQueries();
  client.clear();
});

describe('the cache key', () => {
  it('files a patient own alerts under their own id', async () => {
    mockFetchAlerts.mockResolvedValue([alert(1)]);

    const view = await renderHook(() => useAlerts(), { wrapper });
    await waitFor(() => expect(view.result.current.alerts).toHaveLength(1));

    expect(cached(SELF.id)).toHaveLength(1);
    // Not sent: the gateway takes "no argument" to mean the caller, and
    // passing their own id routes the request through the caregiver path for
    // no reason.
    expect(mockFetchAlerts).toHaveBeenCalledWith(undefined);
  });

  it('files a viewed patient alerts under the patient id, not the caregiver', async () => {
    actAsCaregiverViewingPatient();
    mockFetchAlerts.mockResolvedValue([alert(2)]);

    const view = await renderHook(() => useAlerts(), { wrapper });
    await waitFor(() => expect(view.result.current.alerts).toHaveLength(1));

    expect(cached(PATIENT.id)).toHaveLength(1);
    // The whole point of the per-subject key: nothing lands under the
    // caregiver, so re-entering their own tab cannot serve the patient list.
    expect(cached(identity.userId!)).toBeUndefined();
    expect(mockFetchAlerts).toHaveBeenCalledWith(PATIENT.id);
  });

  it('serves each subject from its own entry rather than the last one fetched', async () => {
    // Seeded directly, with nothing stale: the failure this guards against
    // is a *read* from the wrong entry, and a refetch would paper over it by
    // replacing whatever was read a moment later.
    client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    client.setQueryData(keyFor(SELF.id), [alert(1), alert(2)]);
    client.setQueryData(keyFor(PATIENT.id), [alert(3)]);

    const own = await renderHook(() => useAlerts(), { wrapper });
    expect(own.result.current.alerts.map((a) => a.id)).toEqual([1, 2]);

    actAsCaregiverViewingPatient();
    const viewed = await renderHook(() => useAlerts(), { wrapper });
    expect(viewed.result.current.alerts.map((a) => a.id)).toEqual([3]);
    // Served entirely from cache — the two entries never had to be told
    // apart by a request.
    expect(mockFetchAlerts).not.toHaveBeenCalled();
  });
});

describe('when it declines to fetch', () => {
  it('asks for nothing while signed out, and reports an empty list', async () => {
    actAsSignedOut();

    const view = await renderHook(() => useAlerts(), { wrapper });

    expect(mockFetchAlerts).not.toHaveBeenCalled();
    // Not undefined: every caller does `alerts.filter(...)` or renders a
    // count from it, so the empty array is part of the contract.
    expect(view.result.current.alerts).toEqual([]);
    expect(view.result.current.unreadCount).toBe(0);
  });

  it('asks for nothing while the session has no subject yet', async () => {
    // Authenticated for a frame before `userId` lands. `useSubject` reports
    // `''`, and a fetch here would go out on every render of every screen
    // that shows the bell.
    identity.userId = null;
    identity.isAuthenticated = true;

    await renderHook(() => useAlerts(), { wrapper });

    expect(mockFetchAlerts).not.toHaveBeenCalled();
  });
});

describe('what the bell shows', () => {
  it('counts only the unread ones', async () => {
    mockFetchAlerts.mockResolvedValue([alert(1), alert(2, true), alert(3)]);

    const view = await renderHook(() => useAlerts(), { wrapper });

    await waitFor(() => expect(view.result.current.unreadCount).toBe(2));
  });

  it('hides the mark-read controls from a caregiver', async () => {
    // `markRead` on the gateway is scoped to the alert owner, so a
    // caregiver's attempt matches no rows and returns false — a silent no-op
    // the UI would otherwise render as success.
    actAsCaregiverViewingPatient();

    const view = await renderHook(() => useAlerts(), { wrapper });

    expect(view.result.current.canMarkRead).toBe(false);
  });

  it('offers them to a patient looking at their own alerts', async () => {
    const view = await renderHook(() => useAlerts(), { wrapper });

    expect(view.result.current.canMarkRead).toBe(true);
  });
});

describe('a failed fetch', () => {
  it('hands the caller the typed error, not a flattened one', async () => {
    // `extensions.code` is a client-visible contract — the 401 fan-out and
    // the throttle countdown both dispatch on it, so a screen that receives
    // a bare `Error` has lost the only thing it can branch on.
    mockFetchAlerts.mockRejectedValue(
      new ApiError('[FORBIDDEN] คุณไม่มีสิทธิ์ดูการแจ้งเตือนของผู้ป่วยรายนี้', {
        code: 'FORBIDDEN',
        httpStatus: 403,
        retryAfterSec: 30,
      }),
    );

    const view = await renderHook(() => useAlerts(), { wrapper });

    await waitFor(() => expect(view.result.current.error).toBeInstanceOf(ApiError));
    const error = view.result.current.error as ApiError;
    expect({
      code: error.code,
      httpStatus: error.httpStatus,
      retryAfterSec: error.retryAfterSec,
      message: error.message,
    }).toEqual({
      code: 'FORBIDDEN',
      httpStatus: 403,
      retryAfterSec: 30,
      message: '[FORBIDDEN] คุณไม่มีสิทธิ์ดูการแจ้งเตือนของผู้ป่วยรายนี้',
    });
  });

  it('leaves the list empty rather than undefined', async () => {
    mockFetchAlerts.mockRejectedValue(new ApiError('nope', { code: 'FORBIDDEN' }));

    const view = await renderHook(() => useAlerts(), { wrapper });

    await waitFor(() => expect(view.result.current.error).not.toBeNull());
    expect(view.result.current.alerts).toEqual([]);
    expect(view.result.current.unreadCount).toBe(0);
  });
});

describe('marking one alert read', () => {
  it('decrements the badge before the round trip completes', async () => {
    // The user just tapped the row. A count that waits on the network reads
    // as a tap that did not register, and they tap again.
    client.setQueryData(keyFor(SELF.id), [alert(1), alert(2)]);
    let settle: (value: boolean) => void = () => {};
    mockMarkAlertRead.mockImplementation(() => new Promise<boolean>((r) => (settle = r)));

    const view = await renderHook(() => useMarkAlertRead(), { wrapper });
    await act(async () => {
      view.result.current.markAlertRead(1);
    });

    expect(cached(SELF.id)).toEqual([
      expect.objectContaining({ id: 1, isRead: true }),
      expect.objectContaining({ id: 2, isRead: false }),
    ]);

    await act(async () => {
      settle(true);
    });
  });

  it('restores the exact previous list when the server refuses', async () => {
    const before = [alert(1), alert(2, true)];
    client.setQueryData(keyFor(SELF.id), before);
    mockMarkAlertRead.mockRejectedValue(new ApiError('nope', { code: 'FORBIDDEN' }));

    const view = await renderHook(() => useMarkAlertRead(), { wrapper });
    await act(async () => {
      view.result.current.markAlertRead(1);
    });

    // Deep equality against the snapshot, not just "id 1 is unread again":
    // this cache is the only copy, so a rollback that rebuilds the list
    // slightly differently is a divergence nothing later corrects.
    await waitFor(() => expect(cached(SELF.id)).toEqual(before));
  });

  it('writes under the viewed patient key and leaves the caregiver entry alone', async () => {
    actAsCaregiverViewingPatient();
    const ownAlerts = [alert(1), alert(2)];
    client.setQueryData(keyFor(identity.userId!), ownAlerts);
    client.setQueryData(keyFor(PATIENT.id), [alert(1)]);

    const view = await renderHook(() => useMarkAlertRead(), { wrapper });
    await act(async () => {
      view.result.current.markAlertRead(1);
    });

    // A bare `['alerts']` key would have patched — and on failure rolled
    // back onto — whichever subject was cached last.
    await waitFor(() =>
      expect(cached(PATIENT.id)).toEqual([expect.objectContaining({ id: 1, isRead: true })]),
    );
    expect(cached(identity.userId!)).toBe(ownAlerts);
  });

  it('does not refetch the list after a successful mark', async () => {
    // Recording the current design, not endorsing it: nothing invalidates
    // the query, so the optimistic patch is permanent until the next
    // unrelated refetch. See the finding in the report.
    client.setQueryData(keyFor(SELF.id), [alert(1)]);

    const view = await renderHook(() => useMarkAlertRead(), { wrapper });
    await act(async () => {
      view.result.current.markAlertRead(1);
    });
    await waitFor(() => expect(mockMarkAlertRead).toHaveBeenCalledWith(1));

    expect(mockFetchAlerts).not.toHaveBeenCalled();
  });

  it('survives a mutation that lands before any list is cached', async () => {
    // A push notification can open the alert screen straight onto a row, so
    // `getQueryData` is legitimately undefined when the tap happens.
    const view = await renderHook(() => useMarkAlertRead(), { wrapper });

    await act(async () => {
      view.result.current.markAlertRead(1);
    });

    await waitFor(() => expect(mockMarkAlertRead).toHaveBeenCalledWith(1));
    expect(cached(SELF.id)).toBeUndefined();
  });
});

describe('marking every alert read', () => {
  it('clears the badge immediately and reports the pending state', async () => {
    client.setQueryData(keyFor(SELF.id), [alert(1), alert(2), alert(3, true)]);
    let settle: (value: boolean) => void = () => {};
    mockMarkAllAlertsRead.mockImplementation(() => new Promise<boolean>((r) => (settle = r)));

    const view = await renderHook(() => useMarkAllAlertsRead(), { wrapper });
    await act(async () => {
      view.result.current.markAllAlertsRead();
    });

    expect(cached(SELF.id)!.every((a) => a.isRead)).toBe(true);
    // The control disables on this; without it, a slow round trip invites a
    // second "mark all" that races the first rollback. `waitFor` rather than
    // a bare read: TanStack notifies observers through a timer, so the React
    // state lags the cache write that the line above already saw.
    await waitFor(() => expect(view.result.current.isPending).toBe(true));

    await act(async () => {
      settle(true);
    });
  });

  it('restores the mixed read/unread state when the server refuses', async () => {
    // Restoring "all unread" would be wrong in the other direction: alerts
    // the user had already read would come back as new.
    const before = [alert(1), alert(2, true), alert(3)];
    client.setQueryData(keyFor(SELF.id), before);
    mockMarkAllAlertsRead.mockRejectedValue(new ApiError('nope', { code: 'FORBIDDEN' }));

    const view = await renderHook(() => useMarkAllAlertsRead(), { wrapper });
    await act(async () => {
      view.result.current.markAllAlertsRead();
    });

    await waitFor(() => expect(cached(SELF.id)).toEqual(before));
  });

  it('touches only the subject on screen', async () => {
    actAsCaregiverViewingPatient();
    const ownAlerts = [alert(1), alert(2)];
    client.setQueryData(keyFor(identity.userId!), ownAlerts);
    client.setQueryData(keyFor(PATIENT.id), [alert(1)]);

    const view = await renderHook(() => useMarkAllAlertsRead(), { wrapper });
    await act(async () => {
      view.result.current.markAllAlertsRead();
    });

    await waitFor(() => expect(cached(PATIENT.id)![0].isRead).toBe(true));
    expect(cached(identity.userId!)).toBe(ownAlerts);
  });
});
