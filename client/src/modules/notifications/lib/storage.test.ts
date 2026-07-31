// Same arrangement as stores/preferences.store.test.ts: the native module is
// absent under jest-expo, so the package's own in-memory mock stands in.
// `normalizeReminderSettings` never touches it, but it lives beside the
// load/save pair that does, and importing the file pulls it in.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import { normalizeReminderSettings } from './storage';
import { DEFAULT_REMINDER_SETTINGS } from '../types';

/**
 * These guard the one thing that outlives a build: the blob already sitting
 * in a user's AsyncStorage, written by a version whose options may no longer
 * exist.
 */
describe('normalizeReminderSettings', () => {
  it('returns the defaults for anything that is not an object', () => {
    expect(normalizeReminderSettings(null)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(normalizeReminderSettings('nope')).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(normalizeReminderSettings(undefined)).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it('keeps a complete, valid payload intact', () => {
    const stored = {
      enabled: true,
      intervalHours: 6,
      startHour: 8,
      endHour: 20,
      selectedDays: [1, 3, 5],
      soundId: 'voice3',
    };

    expect(normalizeReminderSettings(stored)).toEqual(stored);
  });

  it('defaults an interval the picker no longer offers', () => {
    const result = normalizeReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, intervalHours: 5 });
    expect(result.intervalHours).toBe(DEFAULT_REMINDER_SETTINGS.intervalHours);
  });

  it('defaults a sound that is no longer bundled', () => {
    const result = normalizeReminderSettings({
      ...DEFAULT_REMINDER_SETTINGS,
      soundId: 'voice9',
    });
    expect(result.soundId).toBe(DEFAULT_REMINDER_SETTINGS.soundId);
  });

  it('repairs both ends when the window closes before it opens', () => {
    // Clamping one end would invent a window the user never chose.
    const result = normalizeReminderSettings({
      ...DEFAULT_REMINDER_SETTINGS,
      startHour: 20,
      endHour: 6,
    });

    expect(result.startHour).toBe(DEFAULT_REMINDER_SETTINGS.startHour);
    expect(result.endHour).toBe(DEFAULT_REMINDER_SETTINGS.endHour);
  });

  it('drops junk weekdays but keeps the valid ones', () => {
    const result = normalizeReminderSettings({
      ...DEFAULT_REMINDER_SETTINGS,
      selectedDays: [1, 1, 9, -3, 2.5, 'x', 4],
    });

    expect(result.selectedDays).toEqual([1, 4]);
  });

  it('falls back to every day when nothing valid survives', () => {
    const result = normalizeReminderSettings({
      ...DEFAULT_REMINDER_SETTINGS,
      selectedDays: ['x', 99],
    });

    expect(result.selectedDays).toEqual(DEFAULT_REMINDER_SETTINGS.selectedDays);
  });

  it('treats a non-boolean `enabled` as off', () => {
    // Failing towards "off" matters: turning notifications on for someone
    // whose preference we could not read is the worse mistake.
    expect(normalizeReminderSettings({ enabled: 'true' }).enabled).toBe(false);
    expect(normalizeReminderSettings({}).enabled).toBe(false);
  });

  it('does not let one bad field reset the others', () => {
    const result = normalizeReminderSettings({
      enabled: true,
      intervalHours: 999,
      startHour: 9,
      endHour: 21,
      selectedDays: [2, 4],
      soundId: 'voice2',
    });

    expect(result.intervalHours).toBe(DEFAULT_REMINDER_SETTINGS.intervalHours);
    expect(result.startHour).toBe(9);
    expect(result.endHour).toBe(21);
    expect(result.selectedDays).toEqual([2, 4]);
    expect(result.soundId).toBe('voice2');
  });
});
