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
 * Two changes fix it, and both survived the move from an interval + window
 * formula to a free-form list of alarm-style times:
 *
 *   1. **Weekly repeats, not dated one-offs.** One trigger per
 *      (weekday, hour, minute) triple repeats forever, so the ceiling is
 *      bounded by the settings themselves instead of growing with a horizon.
 *      It also fires on local wall-clock time, so a DST shift keeps "remind
 *      me at 07:00" meaning 07:00, which a precomputed date does not.
 *   2. **Follow-ups are scheduled on delivery, not up front.** Booking one
 *      alongside every reminder doubled the count to buy nothing: a follow-up
 *      is only wanted when the reminder went unanswered, which is not
 *      knowable a week ahead.
 *
 * `SCHEDULED_NOTIFICATION_BUDGET` leaves no room for the follow-up or a test
 * notification on top of a full week, so this still caps the schedule
 * *before* it reaches the OS rather than letting the OS truncate it.
 *
 * The old model could "thin" a request by widening the interval — every
 * selected day kept reminders, just fewer of them, at a value the picker
 * itself offered. A free-form list of specific times has no interval to
 * widen, so that repair no longer applies. The primary defence moved up a
 * layer instead: `reminders.tsx` computes `reminderTimes.length ×
 * selectedDays.length` before ever calling `update()`, and refuses to add a
 * time or a day that would push the total over budget, with an explanation.
 * A setting built through that screen should therefore never reach this
 * function already over budget.
 *
 * This function caps anyway, as a second line of defence, not a decoration —
 * a stored blob can come from an older build, a future build with a looser
 * picker, or storage edited by hand, and none of those went through this
 * screen's guard. If the request is still too dense, the earliest times are
 * kept and applied identically to every selected day (fair the same way the
 * old widening was: no day silently loses all of its reminders while another
 * keeps every one), and `thinned` is set so the settings screen can say so
 * out loud. Silently dropping the overflow instead is the exact client-old
 * bug this module exists to prevent — it must never happen quietly.
 */
import { normalizeReminderTimes, type ReminderSettings } from '../types';

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
  minute: number;
};

export type ReminderPlan = {
  slots: ReminderSlot[];
  /**
   * How many (time × day) pairs were requested, before any capping. Equal to
   * `slots.length` unless `thinned` — the settings screen needs both numbers
   * to say "you asked for N, only M fit".
   */
  requestedCount: number;
  /** True when the request exceeded the budget and had to be capped. */
  thinned: boolean;
};

export function planReminders(settings: ReminderSettings): ReminderPlan {
  const days = [...new Set(settings.selectedDays)].filter(
    (day) => Number.isInteger(day) && day >= 0 && day <= 6,
  );
  const times = normalizeReminderTimes(settings.reminderTimes);

  if (!settings.enabled || days.length === 0 || times.length === 0) {
    return { slots: [], requestedCount: 0, thinned: false };
  }

  const requestedCount = days.length * times.length;

  // Keep the earliest times, capped so every selected day can have the same
  // reduced set — see the module docblock for why this is a safety net
  // rather than the primary defence.
  const maxTimesPerDay = Math.max(1, Math.floor(SCHEDULED_NOTIFICATION_BUDGET / days.length));
  const cappedTimes = times.length > maxTimesPerDay ? times.slice(0, maxTimesPerDay) : times;

  const slots: ReminderSlot[] = [];
  for (const weekday of [...days].sort((a, b) => a - b)) {
    for (const time of cappedTimes) {
      slots.push({ weekday, hour: time.hour, minute: time.minute });
    }
  }

  return {
    slots,
    requestedCount,
    thinned: cappedTimes.length !== times.length,
  };
}

/**
 * A stable identity for a slot, so a reschedule can tell "already registered"
 * from "newly requested" instead of cancelling and re-adding everything —
 * which on Android briefly leaves the user with no reminders at all.
 */
export function slotKey(slot: ReminderSlot): string {
  return `${slot.weekday}:${slot.hour}:${slot.minute}`;
}
