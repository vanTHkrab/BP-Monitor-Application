/**
 * Everything reminder-shaped that touches expo-notifications. I/O only — the
 * decisions about *what* to schedule live in `lib/schedule-plan.ts`, which is
 * pure and tested.
 *
 * The package itself is loaded through `notifications-module.ts`, never
 * imported at the top of this file; the reason is written there.
 */
import { Platform } from 'react-native';

import { planReminders, type ReminderPlan } from '../lib/schedule-plan';
import {
  loadNotifications,
  type NotificationsModule,
} from './notifications-module';
import {
  getReminderSoundOption,
  type ReminderDiagnostics,
  type ReminderPermissionState,
  type ReminderSettings,
} from '../types';

/** Marks our own notifications so a reschedule cannot cancel someone else's. */
export const REMINDER_KIND = 'bp_reminder';
export const FOLLOW_UP_KIND = 'bp_reminder_follow_up';
const CATEGORY_ID = 'bp_reminder_actions';

export const REMINDER_DONE_ACTION_ID = 'bp_reminder_done';
export const REMINDER_SNOOZE_ACTION_ID = 'bp_reminder_snooze_5';

/** Minutes after an unanswered reminder before the follow-up fires. */
const FOLLOW_UP_DELAY_MINUTES = 15;
const SNOOZE_MINUTES = 5;


/**
 * Asks for notification permission.
 *
 * Called when the user turns reminders on, never at launch. On Android 13+
 * `POST_NOTIFICATIONS` is a runtime permission with one shot: ask at a moment
 * the user cannot connect to a request they made, and the OS remembers the
 * denial forever. From then on `canAskAgain` is false and the only route back
 * is the system settings screen — which is why `'blocked'` is a distinct
 * state here rather than folded into `'denied'`. The UI says different things
 * for the two, because only one of them can be fixed by tapping again.
 */
export async function requestReminderPermission(): Promise<ReminderPermissionState> {
  const Notifications = await loadNotifications();
  if (!Notifications) return 'unsupported';

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';

  if (!current.canAskAgain) return 'blocked';

  const requested = await Notifications.requestPermissionsAsync();
  if (requested.granted) return 'granted';
  return requested.canAskAgain ? 'denied' : 'blocked';
}

export async function getPermissionState(): Promise<ReminderPermissionState> {
  const Notifications = await loadNotifications();
  if (!Notifications) return 'unsupported';

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (current.canAskAgain) return 'undetermined';
  return 'blocked';
}

/**
 * Android delivers a notification's sound from its channel, and a channel's
 * sound is fixed at creation — changing it later is ignored. One channel per
 * voice is therefore the only arrangement in which the sound setting does
 * anything on a device that has already fired a reminder.
 */
async function ensureChannel(
  Notifications: NotificationsModule,
  settings: ReminderSettings,
): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;

  const sound = getReminderSoundOption(settings.soundId);
  await Notifications.setNotificationChannelAsync(sound.channelId, {
    name: `การเตือนวัดความดัน — ${sound.label}`,
    importance: Notifications.AndroidImportance.HIGH,
    sound: sound.fileName,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#3498DB',
  });

  return sound.channelId;
}

async function ensureCategory(Notifications: NotificationsModule): Promise<void> {
  await Notifications.setNotificationCategoryAsync(CATEGORY_ID, [
    {
      identifier: REMINDER_DONE_ACTION_ID,
      buttonTitle: 'บันทึกแล้ว',
      options: { opensAppToForeground: false },
    },
    {
      identifier: REMINDER_SNOOZE_ACTION_ID,
      buttonTitle: 'เตือนอีก 5 นาที',
      options: { opensAppToForeground: false },
    },
  ]);
}

/** Cancels only this app's reminders, matched on the `kind` we stamped. */
async function cancelReminderNotifications(
  Notifications: NotificationsModule,
): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  await Promise.all(
    scheduled
      .filter((notification) => {
        const kind = notification.content.data?.kind;
        return kind === REMINDER_KIND || kind === FOLLOW_UP_KIND;
      })
      .map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier),
      ),
  );
}

/**
 * Registers the weekly schedule, replacing whatever was there.
 *
 * Returns the plan so the caller can tell the user when their request was
 * thinned to fit the budget — a schedule quietly different from the one they
 * chose is the failure this whole module was written to stop.
 */
export async function applyReminderSchedule(
  settings: ReminderSettings,
): Promise<ReminderPlan> {
  const plan = planReminders(settings);
  const Notifications = await loadNotifications();
  if (!Notifications) return plan;

  await cancelReminderNotifications(Notifications);
  if (plan.slots.length === 0) return plan;

  const channelId = await ensureChannel(Notifications, settings);
  await ensureCategory(Notifications);
  const sound = getReminderSoundOption(settings.soundId);

  await Promise.all(
    plan.slots.map((slot) =>
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'ได้เวลาวัดความดันแล้ว',
          body: 'ถ้ายังไม่พร้อม กดเตือนอีก 5 นาทีได้',
          sound: sound.fileName,
          categoryIdentifier: CATEGORY_ID,
          data: { kind: REMINDER_KIND, hour: slot.hour, weekday: slot.weekday },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          // expo-notifications counts weekdays from 1 = Sunday; `Date.getDay()`
          // and everything else in this module count from 0. Off by one here
          // shifts every reminder a day, which reads as "the app is broken"
          // rather than as a bug in one line.
          weekday: slot.weekday + 1,
          hour: slot.hour,
          minute: 0,
          channelId,
        },
      }),
    ),
  );

  return plan;
}

/**
 * Books the "still haven't measured?" nudge, when a reminder is delivered.
 *
 * Scheduled here rather than beside the reminder a week in advance: whether a
 * follow-up is wanted depends on what the user does in the next fifteen
 * minutes, and pre-booking one for every reminder is what put client-old over
 * the OS budget.
 */
export async function scheduleFollowUp(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'ยังไม่ได้วัดความดันใช่ไหม',
      body: 'เมื่อพร้อมแล้วกดที่นี่เพื่อบันทึกค่าได้เลย',
      categoryIdentifier: CATEGORY_ID,
      data: { kind: FOLLOW_UP_KIND },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: FOLLOW_UP_DELAY_MINUTES * 60,
      repeats: false,
    },
  });
}

export async function snoozeReminder(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'ได้เวลาวัดความดันแล้ว',
      body: 'ครบ 5 นาทีตามที่เลื่อนไว้',
      categoryIdentifier: CATEGORY_ID,
      data: { kind: REMINDER_KIND },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: SNOOZE_MINUTES * 60,
      repeats: false,
    },
  });
}

/**
 * Cancels any pending follow-up. Called when the user records a reading or
 * taps "บันทึกแล้ว" — being nagged about something you just did is how an app
 * teaches people to turn its notifications off.
 */
export async function cancelPendingFollowUps(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((notification) => notification.content.data?.kind === FOLLOW_UP_KIND)
      .map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier),
      ),
  );
}

/** Fires in ten seconds, so the user can confirm sound and permission together. */
export async function sendTestReminder(
  settings: ReminderSettings,
): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;

  const permission = await requestReminderPermission();
  if (permission !== 'granted') return false;

  const channelId = await ensureChannel(Notifications, settings);
  const sound = getReminderSoundOption(settings.soundId);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'ทดสอบการแจ้งเตือน',
      body: 'ถ้าคุณเห็นข้อความนี้ แปลว่าระบบแจ้งเตือนทำงานแล้ว',
      sound: sound.fileName,
      data: { kind: FOLLOW_UP_KIND },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 10,
      repeats: false,
      channelId,
    },
  });

  return true;
}

/** What the settings screen shows when someone asks "why isn't this working?" */
export async function getReminderDiagnostics(): Promise<ReminderDiagnostics> {
  const Notifications = await loadNotifications();

  if (!Notifications) {
    return {
      permission: 'unsupported',
      scheduledCount: 0,
      reason:
        'Expo Go บน Android ใช้การแจ้งเตือนไม่ได้ ต้องติดตั้งเป็นแอปจริงก่อน',
    };
  }

  const permission = await getPermissionState();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const scheduledCount = scheduled.filter((notification) => {
    const kind = notification.content.data?.kind;
    return kind === REMINDER_KIND || kind === FOLLOW_UP_KIND;
  }).length;

  const reason =
    permission === 'granted'
      ? scheduledCount > 0
        ? `ตั้งการเตือนไว้ ${scheduledCount} ช่วงต่อสัปดาห์`
        : 'ยังไม่ได้ตั้งเวลาเตือน'
      : permission === 'blocked'
        ? 'ปิดการแจ้งเตือนไว้ในตั้งค่าของเครื่อง ต้องเปิดจากที่นั่นก่อน'
        : 'ยังไม่ได้อนุญาตให้แอปแจ้งเตือน';

  return { permission, scheduledCount, reason };
}
