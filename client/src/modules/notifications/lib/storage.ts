/**
 * Reminder settings, per user, on the device.
 *
 * Per-user because a shared phone is a real case here — a caregiver checking
 * their own readings on the same handset must not inherit the patient's
 * reminder schedule, and signing out must not carry it to the next account.
 *
 * Device-local rather than server-side: the schedule is registered with this
 * OS, so a copy on another device would describe notifications that device
 * never booked. If reminders ever need to follow an account across installs,
 * that is a sync problem, not a storage-location problem.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { reminderSettingsKey } from '@/config';

import {
  DEFAULT_REMINDER_SETTINGS,
  normalizeReminderTimes,
  REMINDER_SOUND_OPTIONS,
  type ReminderSettings,
  type ReminderSoundId,
} from '../types';

const storageKey = reminderSettingsKey;

function isSoundId(value: unknown): value is ReminderSoundId {
  return REMINDER_SOUND_OPTIONS.some((option) => option.id === value);
}

/**
 * Every field is re-checked rather than trusted.
 *
 * The stored blob outlives the build that wrote it: an option removed from
 * the picker in a later version is still sitting in AsyncStorage on someone's
 * phone, and feeding it back into the scheduler produces a schedule the UI
 * cannot represent or undo. Anything unrecognised falls back to the default
 * for that one field, so a single bad value cannot reset the whole config.
 */
export function normalizeReminderSettings(raw: unknown): ReminderSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_REMINDER_SETTINGS };

  const value = raw as Record<string, unknown>;

  const reminderTimes = normalizeReminderTimes(value.reminderTimes);

  const selectedDays = Array.isArray(value.selectedDays)
    ? [...new Set(value.selectedDays)].filter(
        (day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6,
      )
    : DEFAULT_REMINDER_SETTINGS.selectedDays;

  return {
    enabled: value.enabled === true,
    reminderTimes:
      reminderTimes.length > 0 ? reminderTimes : [...DEFAULT_REMINDER_SETTINGS.reminderTimes],
    selectedDays:
      selectedDays.length > 0 ? selectedDays : DEFAULT_REMINDER_SETTINGS.selectedDays,
    soundId: isSoundId(value.soundId)
      ? value.soundId
      : DEFAULT_REMINDER_SETTINGS.soundId,
  };
}

export async function loadReminderSettings(userId?: string): Promise<ReminderSettings> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return { ...DEFAULT_REMINDER_SETTINGS };
    return normalizeReminderSettings(JSON.parse(raw));
  } catch {
    // Unreadable or corrupt storage falls back to "reminders off" rather than
    // to a guess. Silently turning notifications *on* for someone whose
    // preference we just failed to read is the worse of the two mistakes.
    return { ...DEFAULT_REMINDER_SETTINGS };
  }
}

export async function saveReminderSettings(
  settings: ReminderSettings,
  userId?: string,
): Promise<void> {
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(settings));
}
