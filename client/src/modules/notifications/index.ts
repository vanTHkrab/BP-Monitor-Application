/**
 * Public surface of the notifications module. Screens import from here, never
 * from a file inside — same rule as `modules/auth` and `modules/security`.
 *
 * `services/reminder-service.ts` stays unexported: it is the only thing that
 * touches expo-notifications, and a screen scheduling directly would bypass
 * the storage write and the permission gate the hook owns — leaving the OS
 * queue and the saved settings describing different schedules.
 */
export { initReminderNotifications, stopReminderNotifications } from './bootstrap';
export { useReminderSettings } from './hooks/use-reminder-settings';

export { SCHEDULED_NOTIFICATION_BUDGET, planReminders } from './lib/schedule-plan';
export type { ReminderPlan, ReminderSlot } from './lib/schedule-plan';

export {
  DAY_OPTIONS,
  DEFAULT_REMINDER_SETTINGS,
  HOUR_OPTIONS,
  INTERVAL_OPTIONS,
  REMINDER_SOUND_OPTIONS,
  getReminderSoundOption,
  type ReminderDiagnostics,
  type ReminderPermissionState,
  type ReminderSettings,
  type ReminderSoundId,
  type ReminderSoundOption,
} from './types';
