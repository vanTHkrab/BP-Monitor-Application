/**
 * The login throttle countdown — the one hook in this batch that owns a real
 * `setInterval`.
 *
 * Two suites elsewhere had to stub this module out because a live interval
 * survived their test and fired against a torn-down renderer. So the
 * unmount case below is not a completeness exercise: it is the specific
 * defect that already cost two other files a mock.
 *
 * `jest.getTimerCount()` looked like the assertion to reach for and is not:
 * React's renderer and RNTL keep timers of their own alive throughout, so an
 * idle hook reads as 3 and a running one as 7. What `liveIntervals` tracks
 * instead is the set of interval ids **this hook** opened and has not closed —
 * the actual property, and unaffected by the framework's own scheduling. It
 * also catches a cleanup that clears the wrong id, which a bare
 * `clearInterval` call-count spy would not.
 *
 * The other property worth protecting is why this is driven off a wall-clock
 * deadline instead of `setRemaining(n - 1)`: JS is suspended while the app is
 * backgrounded. A decrementing counter resumes where it left off and keeps the
 * retry button disabled long after the server would accept the request. The
 * tests that jump `setSystemTime` without firing the interval are the ones a
 * decrementing implementation fails.
 */
import { act, renderHook } from '@testing-library/react-native';

import { formatCountdown, secondsUntil, useRetryCountdown } from './use-retry-countdown';

const T0 = new Date('2026-02-01T09:00:00.000Z').getTime();

/** Moves the wall clock *without* running timers — what backgrounding does. */
const suspendFor = (ms: number) => jest.setSystemTime(Date.now() + ms);

const tick = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

type IntervalId = ReturnType<typeof setInterval>;

/** Interval ids opened during the test and not yet cleared. */
const liveIntervals = new Set<IntervalId>();

/**
 * Wraps the *fake* timer functions, so it must be installed after
 * `useFakeTimers` and torn down before `useRealTimers`.
 */
function trackIntervals(): void {
  const openInterval = globalThis.setInterval;
  const closeInterval = globalThis.clearInterval;

  jest.spyOn(globalThis, 'setInterval').mockImplementation((...args) => {
    const id = openInterval(...args);
    liveIntervals.add(id);
    return id;
  });

  jest.spyOn(globalThis, 'clearInterval').mockImplementation((id) => {
    if (id !== undefined) liveIntervals.delete(id as IntervalId);
    closeInterval(id);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  liveIntervals.clear();
  trackIntervals();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('secondsUntil', () => {
  it('rounds a part-second up so the button is never re-enabled early', () => {
    // 1.2s left has to read as 2, not 1: showing "1 วินาที" and re-enabling at
    // the wrong edge gets the user a second 429.
    expect(secondsUntil(T0 + 1200, T0)).toBe(2);
  });

  it('clamps a passed deadline to zero rather than going negative', () => {
    expect(secondsUntil(T0 - 5000, T0)).toBe(0);
    expect(secondsUntil(T0, T0)).toBe(0);
  });
});

describe('formatCountdown', () => {
  it('counts in seconds below a minute', () => {
    expect(formatCountdown(45)).toBe('45 วินาที');
    expect(formatCountdown(59)).toBe('59 วินาที');
  });

  it('switches to whole minutes, rounded up, at sixty', () => {
    expect(formatCountdown(60)).toBe('1 นาที');
    expect(formatCountdown(61)).toBe('2 นาที');
    expect(formatCountdown(300)).toBe('5 นาที');
  });
});

describe('useRetryCountdown', () => {
  it('is idle until something throttles, and schedules nothing', async () => {
    const view = await renderHook(() => useRetryCountdown());

    expect(view.result.current.remaining).toBeNull();
    expect(view.result.current.isThrottled).toBe(false);
    expect(liveIntervals.size).toBe(0);
  });

  it('reports the full window immediately, before the first tick', async () => {
    const view = await renderHook(() => useRetryCountdown());

    await act(async () => {
      view.result.current.start(3);
    });

    // Waiting a second to show anything would leave the button dead with no
    // explanation for the first second after a 429.
    expect(view.result.current.remaining).toBe(3);
    expect(view.result.current.isThrottled).toBe(true);
  });

  it('decrements once per second', async () => {
    const view = await renderHook(() => useRetryCountdown());
    await act(async () => {
      view.result.current.start(3);
    });

    await tick(1000);
    expect(view.result.current.remaining).toBe(2);

    await tick(1000);
    expect(view.result.current.remaining).toBe(1);
  });

  it('stops at zero and releases the button', async () => {
    const view = await renderHook(() => useRetryCountdown());
    await act(async () => {
      view.result.current.start(2);
    });

    await tick(2000);

    // `null`, not `0` — the screen renders the countdown when `remaining` is
    // non-null, so a resting `0` would leave "0 วินาที" on screen forever.
    expect(view.result.current.remaining).toBeNull();
    expect(view.result.current.isThrottled).toBe(false);
    // And nothing is left ticking against a countdown that finished.
    expect(liveIntervals.size).toBe(0);
  });

  it('does not tick past zero into negative territory', async () => {
    const view = await renderHook(() => useRetryCountdown());
    await act(async () => {
      view.result.current.start(1);
    });

    await tick(10_000);

    expect(view.result.current.remaining).toBeNull();
  });

  it('catches up after the app was backgrounded, instead of resuming', async () => {
    const view = await renderHook(() => useRetryCountdown());
    await act(async () => {
      view.result.current.start(120);
    });

    // 90 seconds of suspended JS: no interval fired, but the server's window
    // has been closing the whole time.
    suspendFor(90_000);
    await tick(1000);

    // A `setRemaining(n - 1)` implementation reports 119 here and keeps the
    // button disabled for another two minutes the server never asked for.
    expect(view.result.current.remaining).toBe(29);
  });

  it('is already over when the app comes back after the deadline', async () => {
    const view = await renderHook(() => useRetryCountdown());
    await act(async () => {
      view.result.current.start(60);
    });

    suspendFor(10 * 60_000);
    await tick(1000);

    expect(view.result.current.remaining).toBeNull();
    expect(view.result.current.isThrottled).toBe(false);
  });

  it('lets a second throttle replace the first rather than stacking', async () => {
    const view = await renderHook(() => useRetryCountdown());
    await act(async () => {
      view.result.current.start(5);
    });
    await tick(1000);

    await act(async () => {
      view.result.current.start(30);
    });

    expect(view.result.current.remaining).toBe(30);
    // Two intervals would decrement twice per second and reach zero early —
    // re-enabling the button while the server is still refusing.
    expect(liveIntervals.size).toBe(1);
  });

  it('clears on demand and stops ticking', async () => {
    const view = await renderHook(() => useRetryCountdown());
    await act(async () => {
      view.result.current.start(30);
    });

    await act(async () => {
      view.result.current.clear();
    });

    expect(view.result.current.remaining).toBeNull();
    expect(view.result.current.isThrottled).toBe(false);
    expect(liveIntervals.size).toBe(0);

    await tick(5000);
    expect(view.result.current.remaining).toBeNull();
  });

  it('leaves no interval behind when the screen unmounts mid-countdown', async () => {
    const view = await renderHook(() => useRetryCountdown());
    await act(async () => {
      view.result.current.start(300);
    });
    expect(liveIntervals.size).toBe(1);

    // `unmount()` is async in RNTL v14 and has to be awaited inside `act`:
    // calling it bare returns before React has run the effect cleanups, and
    // the interval is still open when the assertion below reads it — which
    // looks exactly like the leak this test is hunting.
    await act(async () => {
      view.unmount();
    });

    // The regression this file exists for. A surviving interval calls
    // `setRemaining` on a torn-down hook every second for five minutes, which
    // in a jest run means it lands in whichever suite happens to be next.
    expect(liveIntervals.size).toBe(0);
  });
});
