/**
 * Public surface of the notifications module. Screens import from here, never
 * from a file inside — same rule as `modules/auth` and `modules/security`.
 *
 * `services/reminder-service.ts` stays unexported: it is the only thing that
 * touches expo-notifications, and a screen scheduling directly would bypass
 * the storage write and the permission gate the hook owns — leaving the OS
 * queue and the saved settings describing different schedules.
 */
export {
  initReminderNotifications,
  registerPushNotifications,
  stopReminderNotifications,
} from './bootstrap';
export { notifyNewInvites } from './services/invite-notification';
/*
 * `services/push-registration.ts` is otherwise unexported for the same reason
 * `reminder-service.ts` is: registration owns a permission prompt that must be
 * asked at most once, and a screen calling it directly would spend the app's
 * one shot at `POST_NOTIFICATIONS`. `forgetPushToken` and
 * `getRegisteredPushToken` are reached by `modules/auth/hooks/use-logout.ts`
 * through a deep import, which the header comment there explains — routing
 * them through this barrel would close a cycle back into `@/modules/auth`.
 */
export { useReminderSettings } from './hooks/use-reminder-settings';

export { SCHEDULED_NOTIFICATION_BUDGET, planReminders } from './lib/schedule-plan';
export type { ReminderPlan, ReminderSlot } from './lib/schedule-plan';

export { ReminderTimelineCard } from './components/reminder-timeline-card';
export { buildReminderTimeline, summariseTimeline } from './lib/reminder-timeline';
export type {
  ReminderRound,
  ReminderRoundStatus,
  ReminderTimelineSummary,
  TimelineReading,
} from './lib/reminder-timeline';

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
