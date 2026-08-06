/**
 * Counts down the login throttle.
 *
 * Driven off a wall-clock deadline rather than by decrementing a number once
 * per tick: JS gets suspended when the app is backgrounded, so a decrementing
 * counter drifts and can leave the button disabled long after the server
 * would accept a retry.
 */
import { useEffect, useRef, useState } from 'react';

/** Seconds remaining until `deadline`, never negative. */
export const secondsUntil = (deadline: number, now: number): number =>
  Math.max(0, Math.ceil((deadline - now) / 1000));

export const formatCountdown = (seconds: number): string =>
  seconds >= 60 ? `${Math.ceil(seconds / 60)} นาที` : `${seconds} วินาที`;

export function useRetryCountdown() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (deadlineRef.current === null) return;

    const tick = () => {
      const left = secondsUntil(deadlineRef.current ?? 0, Date.now());
      if (left <= 0) {
        deadlineRef.current = null;
        setRemaining(null);
      } else {
        setRemaining(left);
      }
    };

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [remaining]);

  return {
    /** Null when not throttled. */
    remaining,
    isThrottled: remaining !== null && remaining > 0,
    start: (seconds: number) => {
      deadlineRef.current = Date.now() + seconds * 1000;
      setRemaining(seconds);
    },
    clear: () => {
      deadlineRef.current = null;
      setRemaining(null);
    },
  };
}
