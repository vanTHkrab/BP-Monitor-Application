import {
  buildReminderTimeline,
  summariseTimeline,
  type ReminderRound,
  type TimelineReading,
} from './reminder-timeline';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../types';

/** A Thursday. Nothing depends on which weekday it is except where stated. */
const DAY = new Date(2026, 7, 6);

const at = (hour: number, minute = 0) => new Date(2026, 7, 6, hour, minute, 0, 0);

const enabled = (overrides: Partial<ReminderSettings> = {}): ReminderSettings => ({
  ...DEFAULT_REMINDER_SETTINGS,
  enabled: true,
  // Every weekday, so a test that is not about weekdays never accidentally
  // lands on one that is unselected.
  selectedDays: [0, 1, 2, 3, 4, 5, 6],
  ...overrides,
});

const reading = (key: string, measuredAt: Date): TimelineReading => ({ key, measuredAt });

const build = (overrides: {
  settings?: ReminderSettings;
  readings?: TimelineReading[];
  date?: Date;
  now?: Date;
}) =>
  buildReminderTimeline({
    settings: overrides.settings ?? enabled(),
    readings: overrides.readings ?? [],
    date: overrides.date ?? DAY,
    // End of the day, so every round has already passed unless a test says
    // otherwise. Tests about "upcoming" set this explicitly.
    now: overrides.now ?? at(23, 59),
  });

const labels = (rounds: ReminderRound[]) => rounds.map((round) => round.label);
const statuses = (rounds: ReminderRound[]) => rounds.map((round) => round.status);

describe('buildReminderTimeline — when there are no rounds', () => {
  it('returns nothing when reminders are off', () => {
    expect(build({ settings: enabled({ enabled: false }) })).toEqual([]);
  });

  it('returns nothing when today is not a selected weekday', () => {
    const otherDays = [0, 1, 2, 3, 4, 5, 6].filter((day) => day !== DAY.getDay());
    expect(build({ settings: enabled({ selectedDays: otherDays }) })).toEqual([]);
  });

  it('returns nothing when no weekday is selected at all', () => {
    expect(build({ settings: enabled({ selectedDays: [] }) })).toEqual([]);
  });
});

describe('buildReminderTimeline — the rounds themselves', () => {
  it('walks the window at the configured interval', () => {
    const rounds = build({
      settings: enabled({ startHour: 7, endHour: 19, intervalHours: 4 }),
    });
    expect(labels(rounds)).toEqual(['07:00', '11:00', '15:00', '19:00']);
  });

  it('derives rounds from the plan, so a thinned schedule is what is shown', () => {
    // 05:00–22:00 every 2 hours over 7 days is 63 slots against a budget of
    // 56, so `planReminders` widens it to 3. Showing the *requested* 2-hour
    // rounds here would put 07:00 on screen and then mark it missed, for a
    // reminder the OS was never asked to send.
    const rounds = build({
      settings: enabled({ startHour: 5, endHour: 22, intervalHours: 2 }),
    });
    expect(labels(rounds)).toEqual(['05:00', '08:00', '11:00', '14:00', '17:00', '20:00']);
  });

  it('pads the hour and pins the round to the top of it', () => {
    const rounds = build({ settings: enabled({ startHour: 7, endHour: 7 }) });
    expect(rounds[0].label).toBe('07:00');
    expect(rounds[0].scheduledAt).toEqual(at(7));
  });

  it('gives every round a distinct, date-qualified key', () => {
    const rounds = build({
      settings: enabled({ startHour: 7, endHour: 19, intervalHours: 4 }),
    });
    expect(rounds.map((round) => round.key)).toEqual([
      '2026-08-06:07',
      '2026-08-06:11',
      '2026-08-06:15',
      '2026-08-06:19',
    ]);
  });
});

describe('buildReminderTimeline — matching readings to rounds', () => {
  const settings = enabled({ startHour: 7, endHour: 19, intervalHours: 4 });

  it('completes a round with a reading taken inside its window', () => {
    const rounds = build({ settings, readings: [reading('a', at(11, 20))] });
    expect(statuses(rounds)).toEqual(['missed', 'completed', 'missed', 'missed']);
    expect(rounds[1].measuredAt).toEqual(at(11, 20));
    expect(rounds[1].minutesLate).toBe(20);
  });

  it('reports zero minutes late for a reading exactly on the hour', () => {
    const rounds = build({ settings, readings: [reading('a', at(7))] });
    expect(rounds[0].minutesLate).toBe(0);
  });

  it('leaves minutesLate and measuredAt unset on a round nothing answered', () => {
    const rounds = build({ settings });
    expect(rounds[0].minutesLate).toBeUndefined();
    expect(rounds[0].measuredAt).toBeUndefined();
  });

  it('does not credit a round with a reading taken before it', () => {
    // 06:30 is before the 07:00 round. client-old's window is
    // half-open forward, so an early measurement answers nothing.
    const rounds = build({ settings, readings: [reading('a', at(6, 30))] });
    expect(statuses(rounds)).toEqual(['missed', 'missed', 'missed', 'missed']);
  });

  it('lets one reading answer only one round', () => {
    // Three measurements before 11:00 must not clear the whole day.
    const rounds = build({
      settings,
      readings: [reading('a', at(7, 5)), reading('b', at(7, 40)), reading('c', at(8, 10))],
    });
    expect(statuses(rounds)).toEqual(['completed', 'missed', 'missed', 'missed']);
  });

  it('matches the earliest unclaimed reading in a window', () => {
    const rounds = build({
      settings,
      readings: [reading('late', at(11, 50)), reading('early', at(11, 10))],
    });
    expect(rounds[1].measuredAt).toEqual(at(11, 10));
  });

  it('lets the last round absorb anything after it, up to midnight', () => {
    const rounds = build({ settings, readings: [reading('a', at(22, 30))] });
    expect(rounds[3].status).toBe('completed');
  });

  it('ignores readings from another day', () => {
    const yesterday = new Date(2026, 7, 5, 11, 20);
    const tomorrow = new Date(2026, 7, 7, 11, 20);
    const rounds = build({
      settings,
      readings: [reading('a', yesterday), reading('b', tomorrow)],
    });
    expect(statuses(rounds)).toEqual(['missed', 'missed', 'missed', 'missed']);
  });
});

describe('buildReminderTimeline — the clock', () => {
  const settings = enabled({ startHour: 7, endHour: 19, intervalHours: 4 });

  it('calls an unanswered future round upcoming, not missed', () => {
    const rounds = build({ settings, now: at(12) });
    expect(statuses(rounds)).toEqual(['missed', 'missed', 'upcoming', 'upcoming']);
  });

  it('treats a round as due the moment its hour arrives', () => {
    const rounds = build({ settings, now: at(11) });
    expect(rounds[1].status).toBe('missed');
  });

  it('shows the whole day as upcoming before the first round', () => {
    const rounds = build({ settings, now: at(6) });
    expect(statuses(rounds)).toEqual(['upcoming', 'upcoming', 'upcoming', 'upcoming']);
  });

  it('does not let the clock override a completed round', () => {
    // A reading answers its round even when `now` is still before it — the
    // measurement is the fact, the clock only classifies the ones without one.
    const rounds = build({ settings, readings: [reading('a', at(15, 5))], now: at(12) });
    expect(rounds[2].status).toBe('completed');
  });
});

describe('summariseTimeline', () => {
  it('counts each status and the total', () => {
    const rounds = build({
      settings: enabled({ startHour: 7, endHour: 19, intervalHours: 4 }),
      readings: [reading('a', at(7, 10))],
      now: at(12),
    });
    expect(summariseTimeline(rounds)).toEqual({
      completed: 1,
      missed: 1,
      upcoming: 2,
      total: 4,
    });
  });

  it('is all zeroes for a day with no rounds', () => {
    expect(summariseTimeline([])).toEqual({
      completed: 0,
      missed: 0,
      upcoming: 0,
      total: 0,
    });
  });
});
