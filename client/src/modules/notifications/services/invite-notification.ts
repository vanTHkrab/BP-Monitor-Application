/**
 * The "someone asked to be your caregiver" local notification.
 *
 * **This is not a push.** The gateway has no push infrastructure at all — no
 * token column, no registration mutation, nothing that sends (C-001, see
 * docs/todo/CLIENT-caregiver.md). What this does is post a local notification
 * the moment *this device* learns about a new invite, which happens on a
 * foreground fetch. A patient whose phone is asleep learns about the invite
 * when they next open the app, not before.
 *
 * That limit is worth stating rather than hiding, because the two look
 * identical when they work and only differ when the app is closed — which is
 * the case the feature is for. When push lands, the caller changes and this
 * stays as the offline/foreground path.
 *
 * Presented immediately (`trigger: null`) rather than scheduled: the event has
 * already happened by the time we know about it, and a delay would put the
 * banner on screen after the user has read the row that caused it.
 */
import { Platform } from 'react-native';

import { loadNotifications } from './notifications-module';

/** Stamped on the payload so this module's own notifications are findable. */
export const INVITE_KIND = 'caregiver_invite';

const CHANNEL_ID = 'caregiver_invites';

/**
 * Its own Android channel, separate from the reminder channels.
 *
 * Android's per-channel controls are the only ones the user actually gets: a
 * patient who mutes measurement reminders must not thereby mute a request for
 * access to their medical history, and vice versa. One shared channel makes
 * that one switch.
 */
async function ensureChannel(): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;

  const Notifications = await loadNotifications();
  if (!Notifications) return undefined;

  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'คำขอเป็นผู้ดูแล',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF8A45',
  });

  return CHANNEL_ID;
}

/**
 * Posts one banner for a batch of newly-seen invites.
 *
 * One notification for the batch rather than one each: a patient who opens
 * the app after a while can discover several at once, and three banners saying
 * the same thing is how a user learns to swipe this category away.
 *
 * Silently does nothing where notifications are unavailable or permission was
 * never granted. It deliberately does **not** request permission — asking at
 * the moment an invite happens to arrive is a prompt the user cannot connect
 * to anything they did, and on Android 13+ a denial there is permanent.
 */
export async function notifyNewInvites(names: string[]): Promise<void> {
  if (names.length === 0) return;

  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;

  const channelId = await ensureChannel();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'มีคำขอเป็นผู้ดูแลของคุณ',
      body:
        names.length === 1
          ? `คุณ${names[0]} ขอดูข้อมูลความดันของคุณ แตะเพื่อตอบรับ`
          : `มี ${names.length} คำขอรอคุณตอบรับ แตะเพื่อดู`,
      data: { kind: INVITE_KIND },
    },
    trigger: channelId ? { channelId } : null,
  });
}
