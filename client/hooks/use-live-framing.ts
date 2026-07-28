import { useCallback, useEffect, useRef, useState } from 'react';

import {
  advanceHysteresis,
  evaluateFraming,
  initialHysteresis,
  type FramingFrame,
  type FramingState,
  type FramingThresholds,
} from '@/utils/framing-state';

/**
 * Turns the raw per-frame detector output into something a person can be shown.
 *
 * Responsibilities, in order:
 *  1. classify each frame (delegated to `utils/framing-state`, pure)
 *  2. smooth the verdict over a dwell window so it doesn't flicker
 *  3. arm / count down / fire auto-capture, and cancel it the moment the shot
 *     stops looking good
 *
 * Everything time-related is expressed in milliseconds rather than frames: the
 * analysis stream runs at roughly 4 fps but that varies with the scene, the
 * device, and thermals, and the user experiences seconds, not frames.
 */

/**
 * How long "ready" must hold before auto-capture starts counting down.
 *
 * This is on top of the dwell that got the state to `ready` in the first place,
 * so the shot has been good for the better part of a second before the ring
 * even appears.
 */
export const AUTO_ARM_DELAY_MS = 300;

/** Visible countdown before the shutter fires. */
export const AUTO_COUNTDOWN_MS = 1500;

/**
 * Countdown used when a screen reader is active.
 *
 * The ring is a purely visual "this is about to happen" cue. A screen-reader
 * user gets one spoken announcement instead, and needs time to hear it and
 * decide — so the window is longer rather than the feature being withheld.
 */
export const AUTO_COUNTDOWN_MS_A11Y = 2500;

export interface LiveFramingOptions {
  /** Master switch — when false the hook holds `searching` and never fires. */
  enabled: boolean;
  /** Whether auto-capture may fire at all (user preference). */
  autoCaptureEnabled: boolean;
  /** Called when the countdown completes. Must be safe to call from a timer. */
  onAutoCapture: () => void;
  /** Longer countdown for screen-reader users. */
  screenReaderEnabled?: boolean;
  thresholds?: FramingThresholds;
}

export interface LiveFramingResult {
  /** Smoothed state to drive guide-frame colour and coaching copy. */
  state: FramingState;
  /** True while the auto-capture countdown is running. */
  isCountingDown: boolean;
  /** 0..1 progress of the countdown, for the ring. */
  countdownProgress: number;
  /** Feed one detector frame in. */
  onFrame: (frame: FramingFrame) => void;
  /**
   * Abandon the current countdown and refuse to re-arm until the shot stops
   * being `ready` at least once. Wired to the user tapping the preview.
   */
  cancelAutoCapture: () => void;
  /** Reset after a capture / retake so a fresh run starts clean. */
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

  const hysteresisRef = useRef(initialHysteresis(Date.now()));
  const readySinceRef = useRef<number | null>(null);
  const countdownStartRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Set when the user cancels. Blocks re-arming until the framing leaves
   * `ready`, so cancelling doesn't just restart the countdown under a finger
   * that is still pointed at the monitor — which would read as the app
   * ignoring the cancel.
   */
  const suppressedRef = useRef(false);
  /**
   * Guards the one-shot fire. A ref, not state, because the interval callback
   * that fires it needs the value synchronously and would otherwise see a
   * stale render's copy.
   */
  const firedRef = useRef(false);

  // Latest callback without making it a dependency of the timer effect — the
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

  const countdownMs = screenReaderEnabled
    ? AUTO_COUNTDOWN_MS_A11Y
    : AUTO_COUNTDOWN_MS;

  const startCountdown = useCallback(() => {
    if (tickRef.current) return;
    const startedAt = Date.now();
    countdownStartRef.current = startedAt;
    setIsCountingDown(true);
    setCountdownProgress(0);

    // A repeating tick drives the ring. It also owns the fire, so there is
    // exactly one place that can trigger the shutter — a separate setTimeout
    // could still fire after the ring was cancelled mid-tick.
    tickRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(1, elapsed / countdownMs);
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
      const observed = evaluateFraming(frame, thresholds);
      const next = advanceHysteresis(hysteresisRef.current, observed, now);
      hysteresisRef.current = next;
      setState(next.committed);

      if (next.committed !== 'ready') {
        // Leaving `ready` both cancels an in-flight countdown and lifts a
        // cancel suppression — the user has re-framed, so the next good shot
        // is allowed to arm again.
        readySinceRef.current = null;
        suppressedRef.current = false;
        if (countdownStartRef.current !== null) clearCountdown();
        return;
      }

      if (!autoCaptureEnabled || suppressedRef.current || firedRef.current) return;

      if (readySinceRef.current === null) readySinceRef.current = now;
      if (now - readySinceRef.current >= AUTO_ARM_DELAY_MS) startCountdown();
    },
    [enabled, autoCaptureEnabled, thresholds, clearCountdown, startCountdown],
  );

  // Stop the clock if the hook is disabled or unmounted mid-countdown —
  // otherwise a backgrounded screen could fire the shutter.
  useEffect(() => {
    if (!enabled) clearCountdown();
  }, [enabled, clearCountdown]);

  useEffect(() => clearCountdown, [clearCountdown]);

  return {
    state,
    isCountingDown,
    countdownProgress,
    onFrame,
    cancelAutoCapture,
    reset,
  };
}
