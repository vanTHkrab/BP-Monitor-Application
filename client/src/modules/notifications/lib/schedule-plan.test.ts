import { planReminders, slotKey, SCHEDULED_NOTIFICATION_BUDGET } from './schedule-plan';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../types';

const time = (hour: number, minute = 0) => ({ hour, minute });

const enabled = (overrides: Partial<ReminderSettings> = {}): ReminderSettings => ({
  ...DEFAULT_REMINDER_SETTINGS,
  enabled: true,
  ...overrides,
});

describe('planReminders', () => {
  it('produces one slot per selected day per reminder time', () => {
    const plan = planReminders(
      enabled({ selectedDays: [1, 3], reminderTimes: [time(7), time(19, 30)] }),
    );

    expect(plan.slots).toHaveLength(4);
    expect(plan.thinned).toBe(false);
    expect(plan.requestedCount).toBe(4);
    expect(plan.slots.map(slotKey)).toEqual([
      '1:7:0',
      '1:19:30',
      '3:7:0',
      '3:19:30',
    ]);
  });

  it('schedules nothing when reminders are off', () => {
    expect(planReminders({ ...DEFAULT_REMINDER_SETTINGS, enabled: false }).slots).toEqual([]);
  });

  it('schedules nothing when no day is selected', () => {
    expect(planReminders(enabled({ selectedDays: [] })).slots).toEqual([]);
  });

  it('schedules nothing when no reminder time is set', () => {
    expect(planReminders(enabled({ reminderTimes: [] })).slots).toEqual([]);
  });

  it('ignores duplicate and out-of-range weekdays', () => {
    const plan = planReminders(
      enabled({ selectedDays: [1, 1, 9, -2, 3.5], reminderTimes: [time(8)] }),
    );

    expect(plan.slots.every((slot) => slot.weekday === 1)).toBe(true);
  });

  it('validates and de-duplicates reminder times the same way normalizeReminderTimes does', () => {
    // A blob a corrupted normalize step let through, or a settings object
    // built by hand in a test — either way this function must not trust it.
    const plan = planReminders(
      enabled({
        selectedDays: [1],
        reminderTimes: [time(7), time(7), { hour: 25, minute: 0 }, time(19)],
      }),
    );

    expect(plan.slots.map(slotKey)).toEqual(['1:7:0', '1:19:0']);
  });

  it('sorts slots by day first, then by time within the day', () => {
    const plan = planReminders(
      enabled({ selectedDays: [3, 1], reminderTimes: [time(19), time(7)] }),
    );

    expect(plan.slots.map(slotKey)).toEqual(['1:7:0', '1:19:0', '3:7:0', '3:19:0']);
  });

  // The regression this module exists for.
  it('stays within the budget for the densest settings the picker allows', () => {
    const denseTimes = Array.from({ length: 12 }, (_, index) => time(5 + index));
    const plan = planReminders(
      enabled({ reminderTimes: denseTimes, selectedDays: [0, 1, 2, 3, 4, 5, 6] }),
    );

    expect(plan.slots.length).toBeLessThanOrEqual(SCHEDULED_NOTIFICATION_BUDGET);
  });

  it('caps rather than dropping days when the request is over budget', () => {
    const denseTimes = Array.from({ length: 12 }, (_, index) => time(5 + index));
    const plan = planReminders(
      enabled({ reminderTimes: denseTimes, selectedDays: [0, 1, 2, 3, 4, 5, 6] }),
    );

    expect(plan.thinned).toBe(true);
    expect(plan.requestedCount).toBe(12 * 7);
    // Every requested day still has reminders — capping must not silently
    // turn "remind me every day" into "remind me on weekdays".
    expect(new Set(plan.slots.map((slot) => slot.weekday)).size).toBe(7);
  });

  it('keeps the same reduced set of times on every day when capping', () => {
    const denseTimes = Array.from({ length: 12 }, (_, index) => time(5 + index));
    const plan = planReminders(
      enabled({ reminderTimes: denseTimes, selectedDays: [0, 1, 2, 3, 4, 5, 6] }),
    );

    const hoursFor = (weekday: number) =>
      plan.slots.filter((slot) => slot.weekday === weekday).map((slot) => slot.hour);

    // No day silently loses all of its reminders while another keeps every
    // one — Sunday and Saturday get the identical, reduced set.
    expect(hoursFor(0)).toEqual(hoursFor(6));
    expect(hoursFor(0).length).toBeGreaterThan(0);
  });

  it('keeps the earliest times when it has to cap, not an arbitrary subset', () => {
    const denseTimes = Array.from({ length: 12 }, (_, index) => time(5 + index));
    const plan = planReminders(
      enabled({ reminderTimes: denseTimes, selectedDays: [0, 1, 2, 3, 4, 5, 6] }),
    );

    const sunday = plan.slots.filter((slot) => slot.weekday === 0).map((slot) => slot.hour);
    // floor(56 / 7) = 8 times per day, earliest first.
    expect(sunday).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('never caps a request that already fits', () => {
    const plan = planReminders(
      enabled({ reminderTimes: [time(7), time(12, 30), time(19)], selectedDays: [1] }),
    );

    expect(plan.thinned).toBe(false);
    expect(plan.slots).toHaveLength(3);
  });
});
