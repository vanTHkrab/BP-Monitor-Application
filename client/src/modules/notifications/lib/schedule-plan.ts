/**
 * Turns reminder settings into the weekly slots to register with the OS.
 *
 * Pure and separately tested, because the bug it exists to prevent is
 * invisible at runtime: iOS silently caps an app at 64 pending notifications
 * and drops everything past it. No error, no callback, no log — reminders
 * just stop, days later, for the patients who scheduled the most of them.
 *
 * client-old hit this. It enumerated concrete dates across a 14-day horizon
 * and queued a follow-up alongside every one, so a patient asking to be
 * reminded every 2 hours booked 14 × 9 × 2 = 252 notifications against a
 * budget of 64. The first two days worked, which is exactly why nobody
 * noticed.
 *
 * Two changes fix it:
 *
 *   1. **Weekly repeats, not dated one-offs.** One trigger per
 *      (weekday, hour) pair repeats forever, so the ceiling is bounded by the
 *      settings themselves — at most 7 × 9 = 63 — instead of growing with the
 *      horizon. It also fires on local wall-clock time, so a DST shift keeps
 *      "remind me at 07:00" meaning 07:00, which a precomputed date does not.
 *   2. **Follow-ups are scheduled on delivery, not up front.** Booking one
 *      alongside every reminder doubled the count to buy nothing: a follow-up
 *      is only wanted when the reminder went unanswered, which is not
 *      knowable a week ahead.
 *
 * Even so, 63 is close enough to 64 to leave no room for the follow-up or a
 * test notification, so this thins the schedule *before* it reaches the OS
 * rather than letting the OS truncate it. Thinning widens the interval —
 * every selected day keeps reminders, just fewer. Truncating a sorted list
 * instead, which is the obvious implementation, would give Sunday a full day
 * of reminders and Saturday none.
 */
import { INTERVAL_OPTIONS, type ReminderSettings } from '../types';

/**
 * iOS's hard limit is 64 pending notifications. The headroom is for the
 * dynamically-scheduled follow-up and the "test notification" button, both of
 * which are booked on top of the weekly schedule.
 */
export const SCHEDULED_NOTIFICATION_BUDGET = 56;

export type ReminderSlot = {
  /** `0` = Sunday, matching `Date.getDay()` and expo-notifications' `weekday - 1`. */
  weekday: number;
  hour: number;
};

export type ReminderPlan = {
  slots: ReminderSlot[];
  /**
   * The interval actually used. Differs from the requested one only when the
   * request did not fit the budget — the UI tells the user when it does.
   */
  effectiveIntervalHours: number;
  /** True when `effectiveIntervalHours` had to be widened to fit. */
  thinned: boolean;
};

/** The hours a reminder fires on a given day, for a given interval. */
export function buildReminderHours(
  startHour: number,
  endHour: number,
  intervalHours: number,
): number[] {
  // A window that ends before it starts is a settings bug, not a wrap-around
  // request: nothing in the UI can produce one, and interpreting it as
  // "overnight" would silently schedule reminders at 3am.
  if (endHour < startHour) return [startHour];
  if (intervalHours <= 0) return [startHour];

  const hours: number[] = [];
  for (let hour = startHour; hour <= endHour; hour += intervalHours) {
    hours.push(hour);
  }
  return hours;
}

export function planReminders(settings: ReminderSettings): ReminderPlan {
  const days = [...new Set(settings.selectedDays)].filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6,
  );

  if (!settings.enabled || days.length === 0) {
    return {
      slots: [],
      effectiveIntervalHours: settings.intervalHours,
      thinned: false,
    };
  }

  // Widen the interval one documented step at a time until the whole week
  // fits. Stepping through the same options the picker offers means the value
  // shown back to the user is always one they could have chosen themselves.
  const candidates = INTERVAL_OPTIONS.filter(
    (option) => option >= settings.intervalHours,
  );
  const ladder = candidates.length > 0 ? candidates : [settings.intervalHours];

  let effectiveIntervalHours = ladder[ladder.length - 1];
  let hours = buildReminderHours(
    settings.startHour,
    settings.endHour,
    effectiveIntervalHours,
  );

  for (const interval of ladder) {
    const candidateHours = buildReminderHours(
      settings.startHour,
      settings.endHour,
      interval,
    );
    if (candidateHours.length * days.length <= SCHEDULED_NOTIFICATION_BUDGET) {
      effectiveIntervalHours = interval;
      hours = candidateHours;
      break;
    }
  }

  const slots: ReminderSlot[] = [];
  for (const weekday of [...days].sort((a, b) => a - b)) {
    for (const hour of hours) {
      slots.push({ weekday, hour });
    }
  }

  return {
    slots,
    effectiveIntervalHours,
    thinned: effectiveIntervalHours !== settings.intervalHours,
  };
}

/**
 * A stable identity for a slot, so a reschedule can tell "already registered"
 * from "newly requested" instead of cancelling and re-adding everything —
 * which on Android briefly leaves the user with no reminders at all.
 */
export function slotKey(slot: ReminderSlot): string {
  return `${slot.weekday}:${slot.hour}`;
}
