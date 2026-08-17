/**
 * "เช็กรอบวัดของวันนี้" — which of today's reminder rounds have been measured.
 *
 * Ported from client-old's `buildReminderTimelineForDate`
 * (`utils/reminders.ts`), with one substantive change and two contract ones.
 *
 * **The rounds come from `planReminders`, not from `settings.reminderTimes`
 * directly.** client-old had no notification budget, so its timeline could
 * read the requested times straight off the settings. This tree caps the
 * schedule when a week of reminders would not fit the OS's 64-notification
 * ceiling (see `schedule-plan.ts`), so the requested times and the times that
 * actually fire are not always the same set. Building rounds from the
 * request would put a capped-away time on screen and then mark it "ค้างวัด"
 * — telling a patient they missed a reminder that was never sent. Deriving
 * from the plan means this screen and the OS queue cannot disagree, because
 * they are the same function.
 *
 * **`now` is a parameter, not `new Date()`.** The completed / missed /
 * upcoming split is entirely a function of the clock, so the clock has to be
 * injectable or none of it is assertable.
 *
 * **Readings are taken structurally**, as `{ key, measuredAt }`, rather than
 * importing `Reading` from `@/modules/readings`. This module has no other
 * reason to know that one exists, and `modules/caregivers` ⇄ `modules/readings`
 * is already a cycle worth not adding a third corner to.
 *
 * Everything here is pure. The screen joins it against `useReadings()`.
 */
import { planReminders } from './schedule-plan';
import type { ReminderSettings } from '../types';

export type ReminderRoundStatus =
  /** A reading landed in this round's window. */
  | 'completed'
  /** The round's time has passed with no reading against it. */
  | 'missed'
  /** Still in the future. */
  | 'upcoming';

export type ReminderRound = {
  /** Stable list key. Local calendar date + time, so it never shifts on a re-render. */
  key: string;
  scheduledAt: Date;
  /** `HH:mm`, already padded. */
  label: string;
  status: ReminderRoundStatus;
  /** When the matched reading was taken. Absent unless `completed`. */
  measuredAt?: Date;
  /** Minutes between the round and the reading that answered it, floored at 0. */
  minutesLate?: number;
};

/**
 * The shape this needs from a reading. `Reading` satisfies it structurally.
 * `key` is used only as an identity for the "one reading answers one round"
 * rule, so it needs to be stable within a render, not meaningful.
 */
export type TimelineReading = {
  key: string;
  measuredAt: Date;
};

export type ReminderTimelineInput = {
  settings: ReminderSettings;
  readings: TimelineReading[];
  /** The day to build. Any time-of-day; only the calendar date is read. */
  date: Date;
  /** The clock the completed / missed / upcoming split is judged against. */
  now: Date;
};

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function roundKey(scheduledAt: Date): string {
  const year = scheduledAt.getFullYear();
  const month = String(scheduledAt.getMonth() + 1).padStart(2, '0');
  const day = String(scheduledAt.getDate()).padStart(2, '0');
  const hour = String(scheduledAt.getHours()).padStart(2, '0');
  const minute = String(scheduledAt.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}:${hour}:${minute}`;
}

/**
 * Today's reminder rounds, each with whether it has been measured.
 *
 * Returns `[]` when reminders are off, when today is not a selected weekday,
 * or when the settings produce no hours at all — the three cases the screen
 * renders as "วันนี้ยังไม่มีรอบแจ้งเตือน". They are deliberately not
 * distinguished: all three are answered by the same thing, opening reminder
 * settings.
 */
export function buildReminderTimeline({
  settings,
  readings,
  date,
  now,
}: ReminderTimelineInput): ReminderRound[] {
  const dayStart = startOfDay(date);

  // `planReminders` already applies every guard — disabled, no selected days,
  // a request that does not fit the budget — so this needs none of its own.
  const times = planReminders(settings)
    .slots.filter((slot) => slot.weekday === dayStart.getDay())
    .map((slot) => ({ hour: slot.hour, minute: slot.minute }))
    .sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));

  if (times.length === 0) return [];

  const scheduled = times.map(({ hour, minute }) => {
    const at = new Date(dayStart);
    at.setHours(hour, minute, 0, 0);
    return at;
  });

  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const readingsForDay = readings
    .filter(
      (reading) =>
        reading.measuredAt.getTime() >= dayStart.getTime() &&
        reading.measuredAt.getTime() < dayEnd.getTime(),
    )
    .sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());

  // One reading answers one round. Without the used-set a patient who measured
  // three times before breakfast would clear the whole day, since every later
  // round would match the same early reading against its own window.
  const claimed = new Set<string>();

  return scheduled.map((at, index) => {
    const next = scheduled[index + 1];

    const match = readingsForDay.find((reading) => {
      if (claimed.has(reading.key)) return false;
      const measured = reading.measuredAt.getTime();
      return measured >= at.getTime() && (!next || measured < next.getTime());
    });

    if (match) claimed.add(match.key);

    // client-old's rule, kept verbatim: a round is "missed" the moment its
    // time passes. That means the round happening right now reads red until
    // it is answered. Worth revisiting with the screen in front of you — the
    // honest label for it is closer to "ถึงรอบแล้ว" than "ค้างวัด" — but it
    // is a copy and design change, not a port.
    const status: ReminderRoundStatus = match
      ? 'completed'
      : now.getTime() < at.getTime()
        ? 'upcoming'
        : 'missed';

    return {
      key: roundKey(at),
      scheduledAt: at,
      label: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
      status,
      measuredAt: match?.measuredAt,
      minutesLate: match
        ? Math.max(0, Math.round((match.measuredAt.getTime() - at.getTime()) / 60_000))
        : undefined,
    };
  });
}

export type ReminderTimelineSummary = {
  completed: number;
  missed: number;
  upcoming: number;
  total: number;
};

export function summariseTimeline(rounds: ReminderRound[]): ReminderTimelineSummary {
  return {
    completed: rounds.filter((round) => round.status === 'completed').length,
    missed: rounds.filter((round) => round.status === 'missed').length,
    upcoming: rounds.filter((round) => round.status === 'upcoming').length,
    total: rounds.length,
  };
}
