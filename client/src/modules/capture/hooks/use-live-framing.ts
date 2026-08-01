/**
 * The React side of the framing gate.
 *
 * Three jobs, in order: classify each detector frame (delegated to the pure
 * `lib/framing-state.ts`), smooth the verdict so it does not flicker, then
 * arm / count down / fire auto-capture — and cancel it the moment the shot
 * stops looking good.
 *
 * Everything time-related is milliseconds, never frames. The analysis stream
 * runs at roughly 4 fps, but that moves with the scene, the device, and
 * thermals, and the user experiences seconds.
 *
 * **The gate is a nudge, never a gate on the shutter.** Nothing here can stop
 * a manual capture. A detector false negative must not be able to prevent
 * someone recording their blood pressure.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  advanceHysteresis,
  evaluateFraming,
  initialHysteresis,
  type FramingFrame,
  type FramingState,
  type FramingThresholds,
} from '../lib/framing-state';

/**
 * How long `ready` must hold before the countdown starts.
 *
 * On top of the dwell that produced `ready` in the first place, so the shot has
 * been good for the better part of a second before the ring even appears.
 */
export const AUTO_ARM_DELAY_MS = 300;

/** The visible countdown before the shutter fires. */
export const AUTO_COUNTDOWN_MS = 1500;

/**
 * The countdown when a screen reader is on.
 *
 * The ring is a purely visual "this is about to happen" cue. A screen-reader
 * user gets one spoken announcement instead and needs time to hear it and
 * decide — so the window gets longer rather than the feature being withheld.
 */
export const AUTO_COUNTDOWN_MS_A11Y = 2500;

export interface LiveFramingOptions {
  /** Master switch. While false the hook holds `searching` and never fires. */
  enabled: boolean;
  /** Whether auto-capture may fire at all (a user preference). */
  autoCaptureEnabled: boolean;
  /** Called when the countdown completes. Must be safe to call from a timer. */
  onAutoCapture: () => void;
  screenReaderEnabled?: boolean;
  thresholds?: FramingThresholds;
}

export interface LiveFramingResult {
  /** Smoothed state, for the guide-frame colour and the coaching line. */
  state: FramingState;
  isCountingDown: boolean;
  /** 0..1, for the ring. */
  countdownProgress: number;
  /** Feed one detector frame in. */
  onFrame: (frame: FramingFrame) => void;
  /**
   * Abandon the countdown and refuse to re-arm until the shot stops being
   * `ready` at least once. Wired to a tap on the preview.
   */
  cancelAutoCapture: () => void;
  /** Start clean after a capture or a retake. */
  reset: () => void;
}

export function useLiveFraming({
  enabled,
  autoCaptureEnabled,
  onAutoCapture,
  screenReaderEnabled = false,
  thresholds,
}: LiveFramingOptions): LiveFramingResult {
  const [state, setState] = useState<FramingState>('searching');
  const [countdownProgress, setCountdownProgress] = useState(0);
  const [isCountingDown, setIsCountingDown] = useState(false);

  // Seeded at 0 rather than `Date.now()`: reading the clock during render is
  // impure, and the timestamp is irrelevant here anyway — the committed and
  // candidate states are both `searching`, so the first frame either agrees
  // (nothing changes) or disagrees (and restarts the clock with a real now).
  const hysteresisRef = useRef(initialHysteresis(0));
  const readySinceRef = useRef<number | null>(null);
  const countdownStartRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Set when the user cancels. Blocks re-arming until the framing leaves
   * `ready`, so a cancel is not immediately undone by a phone still pointed at
   * the monitor — which reads as the app ignoring the cancel.
   */
  const suppressedRef = useRef(false);
  /**
   * Guards the one-shot fire. A ref rather than state because the interval
   * callback needs the value synchronously and would otherwise see a stale
   * render's copy.
   */
  const firedRef = useRef(false);

  // The latest callback without making it a dependency of the timer — the
  // countdown must not restart because the parent re-rendered.
  const onAutoCaptureRef = useRef(onAutoCapture);
  useEffect(() => {
    onAutoCaptureRef.current = onAutoCapture;
  }, [onAutoCapture]);

  const clearCountdown = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    countdownStartRef.current = null;
    setIsCountingDown(false);
    setCountdownProgress(0);
  }, []);

  const reset = useCallback(() => {
    clearCountdown();
    hysteresisRef.current = initialHysteresis(Date.now());
    readySinceRef.current = null;
    suppressedRef.current = false;
    firedRef.current = false;
    setState('searching');
  }, [clearCountdown]);

  const cancelAutoCapture = useCallback(() => {
    clearCountdown();
    suppressedRef.current = true;
    readySinceRef.current = null;
  }, [clearCountdown]);

  const countdownMs = screenReaderEnabled ? AUTO_COUNTDOWN_MS_A11Y : AUTO_COUNTDOWN_MS;

  const startCountdown = useCallback(() => {
    if (tickRef.current) return;

    const startedAt = Date.now();
    countdownStartRef.current = startedAt;
    setIsCountingDown(true);
    setCountdownProgress(0);

    // The tick drives the ring and owns the fire, so exactly one thing can
    // trigger the shutter. A separate `setTimeout` could still fire after the
    // ring was cancelled mid-tick.
    tickRef.current = setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / countdownMs);
      setCountdownProgress(progress);
      if (progress >= 1 && !firedRef.current) {
        firedRef.current = true;
        clearCountdown();
        onAutoCaptureRef.current();
      }
    }, 50);
  }, [clearCountdown, countdownMs]);

  const onFrame = useCallback(
    (frame: FramingFrame) => {
      if (!enabled) return;

      const now = Date.now();
      const next = advanceHysteresis(
        hysteresisRef.current,
        evaluateFraming(frame, thresholds),
        now,
      );
      hysteresisRef.current = next;
      setState(next.committed);

      if (next.committed !== 'ready') {
        // Leaving `ready` cancels any countdown and lifts a suppression: the
        // user has re-framed, so the next good shot may arm again.
        readySinceRef.current = null;
        suppressedRef.current = false;
        if (countdownStartRef.current !== null) clearCountdown();
        return;
      }

      if (!autoCaptureEnabled || suppressedRef.current || firedRef.current) return;

      readySinceRef.current ??= now;
      if (now - readySinceRef.current >= AUTO_ARM_DELAY_MS) startCountdown();
    },
    [enabled, autoCaptureEnabled, thresholds, clearCountdown, startCountdown],
  );

  // Stop the clock when the gate is switched off or the screen goes away —
  // otherwise a backgrounded screen could still fire the shutter. Written as
  // the effect's *cleanup* rather than its body: the teardown is exactly the
  // moment `enabled` flips false or the screen unmounts, and clearing state
  // inside an effect body is the cascading-render pattern the linter rejects.
  useEffect(() => {
    if (!enabled) return;
    return clearCountdown;
  }, [enabled, clearCountdown]);

  return { state, isCountingDown, countdownProgress, onFrame, cancelAutoCapture, reset };
}
