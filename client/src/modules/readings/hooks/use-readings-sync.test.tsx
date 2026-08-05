/**
 * The triggers, which is the layer that was broken.
 *
 * `lib/sync.test.ts` proves the drain handles every way a single row can fail.
 * None of that helped: the bug was that nothing ever *called* the pull, and
 * the push registered its listeners once per screen. Both are wiring, and
 * wiring is exactly what a unit test of pure logic cannot see — so the ports
 * underneath are mocked here and what gets asserted is *when* they are
 * called, how often, and in which order.
 */
import { AppState } from 'react-native';
import type { ReactNode } from 'react';

import { ReadingsSyncProvider, useReadingsSync } from './use-readings-sync';

// `getDb()` opens the device database, which no test can do. The provider
// only calls it to hand a handle to `clearMirror`, which is mocked below.
// Since `@/database` became lazy this is the call, not the import, that has
// to be stubbed — importing the module is now harmless.
jest.mock('@/database', () => ({ getDb: () => ({}) }));

const mockClearMirror = jest.fn(async () => {});
jest.mock('../repository/mirror', () => ({
  // Forwarded through a wrapper, not passed directly: the factory runs while
  // the imports at the top of this file are still being resolved, and
  // `mockClearMirror` is in its temporal dead zone at that moment. The arrow
  // defers the lookup to call time, which is after the assignment.
  clearMirror: (...args: unknown[]) => mockClearMirror(...(args as [])),
}));

const mockSession = {
  current: { userId: 'u1' as string | null, isAuthenticated: true },
};
jest.mock('@/modules/auth', () => ({
  useSession: () => mockSession.current,
}));

const mockActivePatient = { current: { viewingPatientId: undefined as string | undefined } };
jest.mock('@/modules/caregivers', () => ({
  useActivePatient: () => mockActivePatient.current,
}));

/** Records the push/pull order across both hooks in one place. */
const mockCalls: string[] = [];

const mockSync = jest.fn(async () => {
  mockCalls.push('push');
  return null;
});

const mockFetchReadings = jest.fn(async () => {
  mockCalls.push('pull');
  return mockFetchState.succeeds;
});

const mockFetchState = { succeeds: true, isFetching: false, error: null as string | null };

jest.mock('./use-sync-readings', () => ({
  useSyncReadings: () => ({ sync: mockSync }),
}));

jest.mock('./use-fetch-readings', () => ({
  useFetchReadings: () => ({
    fetchReadings: mockFetchReadings,
    isFetching: mockFetchState.isFetching,
    error: mockFetchState.error,
  }),
}));

const mockNetInfo = {
  listener: null as ((state: { isConnected: boolean }) => void) | null,
};
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    fetch: jest.fn(async () => ({ isConnected: true })),
    addEventListener: jest.fn((listener: (state: { isConnected: boolean }) => void) => {
      mockNetInfo.listener = listener;
      return jest.fn();
    }),
  },
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';

function wrapper({ children }: { children: ReactNode }) {
  return <ReadingsSyncProvider>{children}</ReadingsSyncProvider>;
}

const renderSync = () => renderHook(() => useReadingsSync(), { wrapper });

let appStateHandler: ((state: string) => void) | null = null;
let now = 1_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.length = 0;
  mockSession.current = { userId: 'u1', isAuthenticated: true };
  mockActivePatient.current = { viewingPatientId: undefined };
  mockFetchState.succeeds = true;
  mockFetchState.isFetching = false;
  mockFetchState.error = null;
  mockNetInfo.listener = null;
  appStateHandler = null;
  now = 1_000_000;

  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    handler: (state: string) => void,
  ) => {
    appStateHandler = handler;
    return { remove: jest.fn() };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('mount', () => {
  it('pushes the queue and then pulls the mirror, in that order', async () => {
    await renderSync();

    // The order is the point: a reading that drains during this pass has to
    // come back in the same round-trip, not one refresh later.
    await waitFor(() => expect(mockCalls).toEqual(['push', 'pull']));
  });

  it('does nothing until there is a session', async () => {
    mockSession.current = { userId: null, isAuthenticated: false };

    await renderSync();

    expect(mockCalls).toEqual([]);
  });
});

describe('the subject', () => {
  it('refreshes when a caregiver opens a patient, cooldown or not', async () => {
    const view = await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    // Well inside the cooldown window — but these are someone else's rows,
    // and showing the previous subject's history is not a cache hit.
    now += 1_000;
    mockActivePatient.current = { viewingPatientId: 'patient-9' };
    await view.rerender(undefined);

    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(2));
  });
});

describe('the cooldown', () => {
  it('skips an unforced refresh inside the window and allows it after', async () => {
    const view = await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    now += 5_000;
    await act(async () => {
      await view.result.current.refresh();
    });
    expect(mockFetchReadings).toHaveBeenCalledTimes(1);

    now += 30_000;
    await act(async () => {
      await view.result.current.refresh();
    });
    expect(mockFetchReadings).toHaveBeenCalledTimes(2);
  });

  it('never applies to a forced refresh — the user asked', async () => {
    const view = await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    now += 1_000;
    await act(async () => {
      await view.result.current.refresh({ force: true });
    });

    expect(mockFetchReadings).toHaveBeenCalledTimes(2);
  });

  it('does not start on a failed pull', async () => {
    // Offline at mount. Recording that attempt would leave a user who
    // reconnects a second later stuck with stale history for 30 seconds.
    mockFetchState.succeeds = false;
    const view = await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    mockFetchState.succeeds = true;
    now += 1_000;
    await act(async () => {
      await view.result.current.refresh();
    });

    expect(mockFetchReadings).toHaveBeenCalledTimes(2);
  });
});

describe('overlapping triggers', () => {
  it('collapses into a single pass', async () => {
    const view = await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    // The foreground and offline→online edges routinely fire within a frame
    // of each other. Two passes would race each other into the same tables.
    now += 60_000;
    await act(async () => {
      await Promise.all([
        view.result.current.refresh({ force: true }),
        view.result.current.refresh({ force: true }),
        view.result.current.refresh({ force: true }),
      ]);
    });

    expect(mockFetchReadings).toHaveBeenCalledTimes(2);
  });
});

describe('leaving an account', () => {
  it('clears the mirror when the session ends', async () => {
    const view = await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    mockSession.current = { userId: null, isAuthenticated: false };
    await view.rerender(undefined);

    // The departed account's id, not the new (absent) one — the rows to drop
    // belong to whoever just left.
    expect(mockClearMirror).toHaveBeenCalledWith(expect.anything(), 'u1');
  });

  it('clears it when a different account signs in on the same device', async () => {
    const view = await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    mockSession.current = { userId: 'u2', isAuthenticated: true };
    await view.rerender(undefined);

    expect(mockClearMirror).toHaveBeenCalledWith(expect.anything(), 'u1');
  });

  it('never clears on the first sign-in of a launch', async () => {
    // null → id is a *restore*, and wiping there deletes the offline history
    // the mirror exists to keep visible.
    mockSession.current = { userId: null, isAuthenticated: false };
    const view = await renderSync();

    mockSession.current = { userId: 'u1', isAuthenticated: true };
    await view.rerender(undefined);

    expect(mockClearMirror).not.toHaveBeenCalled();
  });
});

describe('the app-level listeners', () => {
  it('registers exactly one of each, however many screens are mounted', async () => {
    await renderSync();

    // The regression this file exists for: these used to live in
    // `useSyncReadings`, so two tabs plus the save path meant three or four
    // copies of each, all firing on the same foreground transition.
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
    expect(jest.requireMock('@react-native-community/netinfo').default.addEventListener)
      .toHaveBeenCalledTimes(1);
  });

  it('refreshes when the app returns to the foreground, throttled', async () => {
    await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    // Backgrounded for eight seconds. Re-fetching the whole history for that
    // is the reason the foreground trigger is the one that is not forced.
    now += 8_000;
    await act(async () => {
      appStateHandler?.('active');
    });
    expect(mockFetchReadings).toHaveBeenCalledTimes(1);

    now += 40_000;
    await act(async () => {
      appStateHandler?.('active');
    });
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(2));
  });

  it('ignores a background transition', async () => {
    await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    now += 60_000;
    await act(async () => {
      appStateHandler?.('background');
    });

    expect(mockFetchReadings).toHaveBeenCalledTimes(1);
  });

  it('forces a refresh on the offline → online edge only', async () => {
    await renderSync();
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(1));

    // Already connected: NetInfo also emits on reachability changes, and
    // draining on each of those is work with nothing to do.
    await act(async () => {
      mockNetInfo.listener?.({ isConnected: true });
    });
    expect(mockFetchReadings).toHaveBeenCalledTimes(1);

    await act(async () => {
      mockNetInfo.listener?.({ isConnected: false });
    });
    expect(mockFetchReadings).toHaveBeenCalledTimes(1);

    // The rising edge, inside the cooldown — forced, because the queue has
    // something to say and the mirror is stale by definition.
    now += 1_000;
    await act(async () => {
      mockNetInfo.listener?.({ isConnected: true });
    });
    await waitFor(() => expect(mockFetchReadings).toHaveBeenCalledTimes(2));
  });
});
