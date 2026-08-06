import {
  buildReminderHours,
  planReminders,
  slotKey,
  SCHEDULED_NOTIFICATION_BUDGET,
} from './schedule-plan';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../types';

const enabled = (overrides: Partial<ReminderSettings> = {}): ReminderSettings => ({
  ...DEFAULT_REMINDER_SETTINGS,
  enabled: true,
  ...overrides,
});

describe('buildReminderHours', () => {
  it('walks the window at the requested interval, inclusive of the end', () => {
    expect(buildReminderHours(7, 19, 4)).toEqual([7, 11, 15, 19]);
  });

  it('stops before overshooting an end that is not a whole multiple', () => {
    expect(buildReminderHours(7, 18, 4)).toEqual([7, 11, 15]);
  });

  it('returns a single reminder when the window is one hour wide', () => {
    expect(buildReminderHours(9, 9, 4)).toEqual([9]);
  });

  it('refuses to wrap around midnight', () => {
    // Nothing in the picker can produce this, and reading it as "overnight"
    // would schedule reminders at 3am for someone who asked for evenings.
    expect(buildReminderHours(19, 7, 4)).toEqual([19]);
  });

  it('does not loop forever on a zero interval', () => {
    expect(buildReminderHours(7, 19, 0)).toEqual([7]);
  });
});

describe('planReminders', () => {
  it('produces one slot per selected day per hour', () => {
    const plan = planReminders(enabled({ selectedDays: [1, 3], intervalHours: 6 }));

    // 07:00, 13:00, 19:00 on Monday and Wednesday.
    expect(plan.slots).toHaveLength(6);
    expect(plan.thinned).toBe(false);
    expect(plan.slots.map(slotKey)).toEqual([
      '1:7',
      '1:13',
      '1:19',
      '3:7',
      '3:13',
      '3:19',
    ]);
  });

  it('schedules nothing when reminders are off', () => {
    expect(planReminders({ ...DEFAULT_REMINDER_SETTINGS, enabled: false }).slots).toEqual(
      [],
    );
  });

  it('schedules nothing when no day is selected', () => {
    expect(planReminders(enabled({ selectedDays: [] })).slots).toEqual([]);
  });

  it('ignores duplicate and out-of-range weekdays', () => {
    const plan = planReminders(
      enabled({ selectedDays: [1, 1, 9, -2, 3.5], intervalHours: 12 }),
    );

    expect(plan.slots.every((slot) => slot.weekday === 1)).toBe(true);
  });

  // The regression this module exists for.
  it('stays within the budget for the densest settings the picker allows', () => {
    const plan = planReminders(
      enabled({
        intervalHours: 2,
        startHour: 5,
        endHour: 22,
        selectedDays: [0, 1, 2, 3, 4, 5, 6],
      }),
    );

    expect(plan.slots.length).toBeLessThanOrEqual(SCHEDULED_NOTIFICATION_BUDGET);
  });

  it('widens the interval rather than dropping days when over budget', () => {
    const plan = planReminders(
      enabled({
        intervalHours: 2,
        startHour: 5,
        endHour: 22,
        selectedDays: [0, 1, 2, 3, 4, 5, 6],
      }),
    );

    expect(plan.thinned).toBe(true);
    expect(plan.effectiveIntervalHours).toBeGreaterThan(2);
    // Every requested day still has reminders — thinning must not silently
    // turn "remind me every day" into "remind me on weekdays".
    expect(new Set(plan.slots.map((slot) => slot.weekday)).size).toBe(7);
  });

  it('reports the widened interval as one the picker itself offers', () => {
    const plan = planReminders(
      enabled({ intervalHours: 2, startHour: 5, endHour: 22 }),
    );

    expect([2, 3, 4, 6, 8, 12]).toContain(plan.effectiveIntervalHours);
  });

  it('leaves a request that already fits completely alone', () => {
    const plan = planReminders(enabled({ intervalHours: 4, startHour: 7, endHour: 19 }));

    expect(plan.thinned).toBe(false);
    expect(plan.effectiveIntervalHours).toBe(4);
    expect(plan.slots).toHaveLength(28);
  });

  it('never widens past the densest option that fits', () => {
    // A single day can afford the tightest interval; thinning it would be
    // punishing the user for a limit they are nowhere near.
    const plan = planReminders(
      enabled({ intervalHours: 2, startHour: 5, endHour: 22, selectedDays: [1] }),
    );

    expect(plan.effectiveIntervalHours).toBe(2);
    expect(plan.thinned).toBe(false);
  });
});
