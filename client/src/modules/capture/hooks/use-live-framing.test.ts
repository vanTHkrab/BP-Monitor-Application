/**
 * The framing gate's React half: smoothing, arming, and the one-shot fire.
 *
 * `lib/framing-state.test.ts` already owns the classification rules, so
 * nothing here re-asserts which box is "too far". What is only observable
 * from the hook is the part that decides whether a shutter fires by itself:
 * the dwell before a verdict is shown, the extra arm delay before the ring
 * appears, the suppression that survives a cancel, and the guarantee that
 * `onAutoCapture` runs exactly once.
 *
 * This hook owns a real `setInterval`, so it carries the same leak hazard
 * `use-retry-countdown.test.ts` was written for — a surviving tick calls
 * `setCountdownProgress` on a torn-down hook, and in a jest run that lands in
 * whichever suite happens to be next. `liveIntervals` tracks the ids *this
 * hook* opened rather than `jest.getTimerCount()`, which is useless here:
 * React and RNTL keep timers of their own alive throughout. It also catches a
 * cleanup that clears the wrong id, which a `clearInterval` call-count spy
 * would not.
 */
import { act, renderHook } from '@testing-library/react-native';

import { FRAMING_DWELL_MS, type FramingFrame } from '../lib/framing-state';
import {
  AUTO_ARM_DELAY_MS,
  AUTO_COUNTDOWN_MS,
  AUTO_COUNTDOWN_MS_A11Y,
  useLiveFraming,
} from './use-live-framing';

const T0 = new Date('2026-02-01T09:00:00.000Z').getTime();

const FRAME_SIZE = 1000;

/** Frame-pixel boxes, per `framing-state.ts` — nothing here is screen space. */
const box = (x1: number, y1: number, x2: number, y2: number, cls: number) => ({
  x1,
  y1,
  x2,
  y2,
  cls,
  className: `class-${cls}`,
  confidence: 0.9,
});

/**
 * Centred monitor at 25% of frame area with two digit fields visible — inside
 * every `DEFAULT_FRAMING_THRESHOLDS` bound, so it classifies as `ready`.
 */
const READY_FRAME: FramingFrame = {
  frameWidth: FRAME_SIZE,
  frameHeight: FRAME_SIZE,
  detections: [
    box(250, 250, 750, 750, 0),
    box(300, 300, 400, 350, 2),
    box(500, 300, 600, 350, 4),
  ],
};

/** Same monitor, 1% of frame area: `too-far`. */
const TOO_FAR_FRAME: FramingFrame = {
  frameWidth: FRAME_SIZE,
  frameHeight: FRAME_SIZE,
  detections: [box(450, 450, 550, 550, 0)],
};

/** Nothing the detector recognises: `searching`. */
const EMPTY_FRAME: FramingFrame = {
  frameWidth: FRAME_SIZE,
  frameHeight: FRAME_SIZE,
  detections: [],
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

const tick = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

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

type View = { result: { current: { onFrame: (frame: FramingFrame) => void } } };

/** Feeds one frame at the current fake clock. */
const feed = async (view: View, frame: FramingFrame) => {
  await act(async () => {
    view.result.current.onFrame(frame);
  });
};

/**
 * Feeds a frame, waits out the dwell, feeds it again — the minimum needed for
 * a verdict to be *committed* rather than merely observed.
 */
const commit = async (view: View, frame: FramingFrame) => {
  await feed(view, frame);
  await tick(FRAMING_DWELL_MS);
  await feed(view, frame);
};

const renderGate = async (
  options: Partial<Parameters<typeof useLiveFraming>[0]> = {},
) => {
  const onAutoCapture = jest.fn();
  const view = await renderHook(
    (props: { enabled: boolean; autoCaptureEnabled: boolean; screenReaderEnabled: boolean }) =>
      useLiveFraming({ onAutoCapture, ...props }),
    {
      initialProps: {
        enabled: true,
        autoCaptureEnabled: true,
        screenReaderEnabled: false,
        ...options,
      },
    },
  );
  return { view, onAutoCapture };
};

/** Drives a gate all the way from cold to a running countdown. */
const armCountdown = async (view: View) => {
  await commit(view, READY_FRAME);
  await tick(AUTO_ARM_DELAY_MS);
  await feed(view, READY_FRAME);
};

describe('what the coaching line shows', () => {
  it('starts at searching before any frame has arrived', async () => {
    const { view } = await renderGate();

    expect(view.result.current.state).toBe('searching');
    expect(view.result.current.isCountingDown).toBe(false);
    expect(view.result.current.countdownProgress).toBe(0);
    expect(liveIntervals.size).toBe(0);
  });

  it('holds a verdict back until it has survived the dwell', async () => {
    const { view } = await renderGate();

    // One good frame is not enough. Committing on the first frame is what
    // makes the guide frame strobe between colours near every threshold.
    await feed(view, READY_FRAME);
    expect(view.result.current.state).toBe('searching');

    await tick(FRAMING_DWELL_MS);
    await feed(view, READY_FRAME);
    expect(view.result.current.state).toBe('ready');
  });

  it('restarts the dwell when a frame disagrees, rather than averaging', async () => {
    const { view } = await renderGate();

    await feed(view, READY_FRAME);
    await tick(FRAMING_DWELL_MS - 50);
    // A single disagreeing frame resets the contender's clock, so the ready
    // frame that follows has to serve the full dwell again from here.
    await feed(view, TOO_FAR_FRAME);
    await tick(100);
    await feed(view, READY_FRAME);

    expect(view.result.current.state).toBe('searching');
  });

  it('ignores every frame while the gate is switched off', async () => {
    const { view } = await renderGate({ enabled: false });

    await commit(view, READY_FRAME);
    await tick(AUTO_ARM_DELAY_MS + AUTO_COUNTDOWN_MS);

    expect(view.result.current.state).toBe('searching');
    expect(view.result.current.isCountingDown).toBe(false);
    expect(liveIntervals.size).toBe(0);
  });
});

describe('arming the countdown', () => {
  it('waits out the arm delay after ready before showing the ring', async () => {
    const { view } = await renderGate();

    await commit(view, READY_FRAME);
    // Ready, but the ring must not appear yet: the arm delay sits *on top of*
    // the dwell that produced `ready`, so the shot has been good for the
    // better part of a second before anything visible happens.
    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.isCountingDown).toBe(false);

    await tick(AUTO_ARM_DELAY_MS - 1);
    await feed(view, READY_FRAME);
    expect(view.result.current.isCountingDown).toBe(false);

    await tick(1);
    await feed(view, READY_FRAME);
    expect(view.result.current.isCountingDown).toBe(true);
  });

  it('advances the ring toward one and fires at the end of the window', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);

    expect(view.result.current.countdownProgress).toBe(0);

    await tick(AUTO_COUNTDOWN_MS / 2);
    // The ring is the only warning the user gets, so it has to track the
    // window rather than jumping from 0 to 1.
    expect(view.result.current.countdownProgress).toBeCloseTo(0.5, 5);
    expect(onAutoCapture).not.toHaveBeenCalled();

    await tick(AUTO_COUNTDOWN_MS / 2);
    expect(onAutoCapture).toHaveBeenCalledTimes(1);
  });

  it('stops counting down and clears the ring once it has fired', async () => {
    const { view } = await renderGate();
    await armCountdown(view);

    await tick(AUTO_COUNTDOWN_MS);

    expect(view.result.current.isCountingDown).toBe(false);
    expect(view.result.current.countdownProgress).toBe(0);
    // The tick owns the fire, so nothing is left running to fire again.
    expect(liveIntervals.size).toBe(0);
  });

  it('fires once and only once, however long the shot stays good', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);
    await tick(AUTO_COUNTDOWN_MS);

    // The camera is still pointed at the monitor and frames keep arriving.
    // Without the one-shot guard this re-arms and takes a second photo the
    // user never asked for.
    for (let i = 0; i < 5; i += 1) {
      await tick(AUTO_ARM_DELAY_MS);
      await feed(view, READY_FRAME);
    }
    await tick(AUTO_COUNTDOWN_MS * 2);

    expect(onAutoCapture).toHaveBeenCalledTimes(1);
    expect(liveIntervals.size).toBe(0);
  });

  it('opens exactly one interval however many ready frames arrive', async () => {
    const { view } = await renderGate();
    await armCountdown(view);

    // The analysis stream keeps delivering ~4 fps while the ring is up. A
    // second interval would drive the ring twice as fast and fire early.
    await feed(view, READY_FRAME);
    await feed(view, READY_FRAME);

    expect(liveIntervals.size).toBe(1);
  });

  it('gives a screen-reader user the longer window', async () => {
    const { view, onAutoCapture } = await renderGate({ screenReaderEnabled: true });
    await armCountdown(view);

    // The ring is a purely visual cue, so this user is relying on one spoken
    // announcement. At the sighted deadline they must still have time left.
    await tick(AUTO_COUNTDOWN_MS);
    expect(onAutoCapture).not.toHaveBeenCalled();
    expect(view.result.current.isCountingDown).toBe(true);

    await tick(AUTO_COUNTDOWN_MS_A11Y - AUTO_COUNTDOWN_MS);
    expect(onAutoCapture).toHaveBeenCalledTimes(1);
  });

  it('still coaches the framing when auto-capture is switched off', async () => {
    const { view, onAutoCapture } = await renderGate({ autoCaptureEnabled: false });

    await commit(view, READY_FRAME);
    await tick(AUTO_ARM_DELAY_MS);
    await feed(view, READY_FRAME);
    await tick(AUTO_COUNTDOWN_MS * 2);

    // The preference turns off the shutter, not the guide frame — the user
    // who shoots manually still needs to be told the shot is good.
    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.isCountingDown).toBe(false);
    expect(onAutoCapture).not.toHaveBeenCalled();
    expect(liveIntervals.size).toBe(0);
  });
});

describe('losing the shot mid-countdown', () => {
  it('abandons the countdown when the framing stops being ready', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);

    await commit(view, TOO_FAR_FRAME);

    expect(view.result.current.state).toBe('too-far');
    expect(view.result.current.isCountingDown).toBe(false);
    expect(view.result.current.countdownProgress).toBe(0);
    expect(liveIntervals.size).toBe(0);

    await tick(AUTO_COUNTDOWN_MS * 2);
    expect(onAutoCapture).not.toHaveBeenCalled();
  });

  it('rides out a single dropped frame instead of aborting the countdown', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);

    // Cancellation keys off the *committed* verdict, so one frame that lost
    // the monitor cannot abort a countdown — the same hysteresis that stops
    // the guide frame strobing also stops the ring flickering out and back on
    // a detector that blinks. The countdown therefore keeps running here.
    await feed(view, EMPTY_FRAME);
    expect(view.result.current.isCountingDown).toBe(true);
    expect(liveIntervals.size).toBe(1);

    await tick(AUTO_COUNTDOWN_MS);
    expect(onAutoCapture).toHaveBeenCalledTimes(1);
  });

  it('re-arms from zero after the shot is recovered, not from where it stopped', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);
    // Only part-way in, so the dwell the cancellation costs still leaves the
    // countdown short of its deadline — see the dropped-frame case above.
    await tick(FRAMING_DWELL_MS);

    await commit(view, EMPTY_FRAME);
    expect(onAutoCapture).not.toHaveBeenCalled();

    await armCountdown(view);

    // The elapsed time of the abandoned countdown must not carry over — a
    // resumed countdown fires almost immediately after a re-frame, which is
    // exactly when the user is still moving the phone.
    await tick(AUTO_COUNTDOWN_MS - 100);
    expect(onAutoCapture).not.toHaveBeenCalled();

    await tick(100);
    expect(onAutoCapture).toHaveBeenCalledTimes(1);
  });
});

describe('cancelling', () => {
  it('stops the countdown the moment the user taps', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);

    await act(async () => {
      view.result.current.cancelAutoCapture();
    });

    expect(view.result.current.isCountingDown).toBe(false);
    expect(liveIntervals.size).toBe(0);
    await tick(AUTO_COUNTDOWN_MS * 2);
    expect(onAutoCapture).not.toHaveBeenCalled();
  });

  it('refuses to re-arm while the phone is still pointed at the monitor', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);
    await act(async () => {
      view.result.current.cancelAutoCapture();
    });

    // Frames keep arriving and they are still `ready`. Re-arming here reads
    // as the app ignoring the cancel, so the suppression has to outlive it.
    for (let i = 0; i < 10; i += 1) {
      await tick(AUTO_ARM_DELAY_MS);
      await feed(view, READY_FRAME);
    }

    expect(view.result.current.isCountingDown).toBe(false);
    expect(onAutoCapture).not.toHaveBeenCalled();
  });

  it('lifts the suppression once the framing has genuinely been lost', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);
    await act(async () => {
      view.result.current.cancelAutoCapture();
    });

    // The user re-framed. A cancel is about this attempt, not about turning
    // the feature off for the rest of the session.
    await commit(view, EMPTY_FRAME);
    await armCountdown(view);
    await tick(AUTO_COUNTDOWN_MS);

    expect(onAutoCapture).toHaveBeenCalledTimes(1);
  });

  it('leaves the coaching state alone — a cancel is not a re-frame', async () => {
    const { view } = await renderGate();
    await armCountdown(view);

    await act(async () => {
      view.result.current.cancelAutoCapture();
    });

    // The shot is still good and the guide frame should still say so; only
    // the automatic shutter was refused.
    expect(view.result.current.state).toBe('ready');
  });
});

describe('reset', () => {
  it('returns to searching and drops any running countdown', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);

    await act(async () => {
      view.result.current.reset();
    });

    expect(view.result.current.state).toBe('searching');
    expect(view.result.current.isCountingDown).toBe(false);
    expect(view.result.current.countdownProgress).toBe(0);
    expect(liveIntervals.size).toBe(0);

    await tick(AUTO_COUNTDOWN_MS * 2);
    expect(onAutoCapture).not.toHaveBeenCalled();
  });

  it('clears the one-shot guard so a retake can fire again', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);
    await tick(AUTO_COUNTDOWN_MS);
    expect(onAutoCapture).toHaveBeenCalledTimes(1);

    // Retake. Without the guard being cleared the second photo can never be
    // taken automatically, and the feature silently works exactly once per
    // app launch.
    await act(async () => {
      view.result.current.reset();
    });
    await armCountdown(view);
    await tick(AUTO_COUNTDOWN_MS);

    expect(onAutoCapture).toHaveBeenCalledTimes(2);
  });

  it('clears a suppression left by an earlier cancel', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);
    await act(async () => {
      view.result.current.cancelAutoCapture();
    });

    await act(async () => {
      view.result.current.reset();
    });
    await armCountdown(view);
    await tick(AUTO_COUNTDOWN_MS);

    expect(onAutoCapture).toHaveBeenCalledTimes(1);
  });
});

describe('the callback identity', () => {
  it('fires the newest callback without restarting the countdown', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const view = await renderHook(
      ({ onAutoCapture }: { onAutoCapture: () => void }) =>
        useLiveFraming({ enabled: true, autoCaptureEnabled: true, onAutoCapture }),
      { initialProps: { onAutoCapture: first } },
    );

    await armCountdown(view);
    await tick(AUTO_COUNTDOWN_MS / 2);

    // A parent that re-renders with a fresh inline closure must not reset the
    // ring to zero — that would make the countdown unable to ever complete on
    // a screen that re-renders while it runs.
    await act(async () => {
      view.rerender({ onAutoCapture: second });
    });
    expect(view.result.current.countdownProgress).toBeCloseTo(0.5, 5);
    expect(liveIntervals.size).toBe(1);

    await tick(AUTO_COUNTDOWN_MS / 2);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('teardown', () => {
  it('stops the clock when the gate is switched off mid-countdown', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);
    expect(liveIntervals.size).toBe(1);

    await act(async () => {
      view.rerender({ enabled: false, autoCaptureEnabled: true, screenReaderEnabled: false });
    });

    // A backgrounded screen that still owns a live countdown fires the
    // shutter at a phone in someone's pocket.
    expect(liveIntervals.size).toBe(0);
    await tick(AUTO_COUNTDOWN_MS * 2);
    expect(onAutoCapture).not.toHaveBeenCalled();
  });

  it('leaves no interval behind when the screen unmounts mid-countdown', async () => {
    const { view, onAutoCapture } = await renderGate();
    await armCountdown(view);
    expect(liveIntervals.size).toBe(1);

    // `unmount()` is async in RNTL v14 and has to be awaited inside `act`:
    // called bare it returns before React has run the effect cleanups, and
    // the interval is still open when the assertion below reads it — which
    // looks exactly like the leak this test is hunting.
    await act(async () => {
      view.unmount();
    });

    expect(liveIntervals.size).toBe(0);
    await tick(AUTO_COUNTDOWN_MS * 2);
    expect(onAutoCapture).not.toHaveBeenCalled();
  });
});
