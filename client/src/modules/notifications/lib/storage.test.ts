// Same arrangement as stores/preferences.store.test.ts: the native module is
// absent under jest-expo, so the package's own in-memory mock stands in.
// `normalizeReminderSettings` never touches it, but it lives beside the
// load/save pair that does, and importing the file pulls it in.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import AsyncStorage from '@react-native-async-storage/async-storage';

import { loadReminderSettings, normalizeReminderSettings, saveReminderSettings } from './storage';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../types';

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

/**
 * The load/save pair, which is where the per-user key lives. A shared handset
 * is a real case here: a caregiver checking their own readings must not
 * inherit the patient's reminder schedule, and that separation is entirely a
 * property of the key these two functions build.
 */
describe('loadReminderSettings / saveReminderSettings', () => {
  const CUSTOM: ReminderSettings = {
    enabled: true,
    intervalHours: 6,
    startHour: 8,
    endHour: 20,
    selectedDays: [1, 3, 5],
    soundId: 'voice3',
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('round-trips a full settings object', async () => {
    await saveReminderSettings(CUSTOM, 'u-1');

    await expect(loadReminderSettings('u-1')).resolves.toEqual(CUSTOM);
  });

  it('namespaces the key by user id', async () => {
    await saveReminderSettings(CUSTOM, 'u-1');

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'bp.reminder_settings.u-1',
      JSON.stringify(CUSTOM),
    );
  });

  it('files a missing user id under guest, not under a shared key', async () => {
    // The pre-sign-in window, where a schedule can be previewed but not
    // attached to anyone. A shared key would leak it to the next account.
    await saveReminderSettings(CUSTOM);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'bp.reminder_settings.guest',
      JSON.stringify(CUSTOM),
    );
  });

  it('keeps two users on one device apart', async () => {
    await saveReminderSettings(CUSTOM, 'u-1');

    await expect(loadReminderSettings('u-2')).resolves.toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it('returns the defaults when nothing has been saved', async () => {
    await expect(loadReminderSettings('u-1')).resolves.toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it('returns a fresh object, not the shared default constant', async () => {
    // The caller edits what it gets back. Handing out the module-level
    // constant would let one screen's edit become everyone's default.
    const first = await loadReminderSettings('u-1');
    const second = await loadReminderSettings('u-2');

    expect(first).not.toBe(DEFAULT_REMINDER_SETTINGS);
    expect(first).not.toBe(second);
  });

  it('falls back to reminders OFF when the stored blob is corrupt', async () => {
    // Silently turning notifications *on* for someone whose preference we just
    // failed to read is the worse of the two mistakes.
    await AsyncStorage.setItem('bp.reminder_settings.u-1', '{not json');

    await expect(loadReminderSettings('u-1')).resolves.toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it('falls back to reminders OFF when storage itself throws', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('unreadable'));

    const result = await loadReminderSettings('u-1');

    expect(result.enabled).toBe(false);
    expect(result).toEqual(DEFAULT_REMINDER_SETTINGS);
  });

  it('normalises what it loads, so a blob from an older build cannot be scheduled', async () => {
    await AsyncStorage.setItem(
      'bp.reminder_settings.u-1',
      JSON.stringify({ ...CUSTOM, intervalHours: 999, soundId: 'voice99' }),
    );

    await expect(loadReminderSettings('u-1')).resolves.toEqual({
      ...CUSTOM,
      intervalHours: DEFAULT_REMINDER_SETTINGS.intervalHours,
      soundId: DEFAULT_REMINDER_SETTINGS.soundId,
    });
  });
});
