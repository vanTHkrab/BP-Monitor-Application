/**
 * Wires reminder notifications into the running app.
 *
 * Registered once at startup, alongside `initAuth`. Two listeners:
 *
 *   - **Received.** A delivered reminder books its own follow-up fifteen
 *     minutes out. That is why the schedule fits the OS budget at all — the
 *     alternative, pre-booking a follow-up beside every reminder for the week,
 *     is what pushed client-old past the ceiling.
 *   - **Response.** What the user did with it. The action buttons resolve
 *     without opening the app; a plain tap goes to the capture screen, because
 *     the only reason to open a "measure your blood pressure" notification is
 *     to measure your blood pressure.
 *
 * Both are no-ops where notifications are unavailable (Expo Go on Android),
 * so nothing here needs a platform branch at the call site.
 */
import { router } from 'expo-router';

import {
  cancelPendingFollowUps,
  isNotificationSupported,
  scheduleFollowUp,
  snoozeReminder,
  FOLLOW_UP_KIND,
  REMINDER_DONE_ACTION_ID,
  REMINDER_KIND,
  REMINDER_SNOOZE_ACTION_ID,
} from './services/reminder-service';

type Unsubscribe = () => void;

let teardown: Unsubscribe | null = null;

/**
 * Where a tapped reminder lands.
 *
 * Capture rather than the dashboard: the only reason to open a "measure your
 * blood pressure" notification is to measure it.
 *
 * `(tabs)/camera` is still a `ScreenPlaceholder` in this tree, so today the
 * tap lands on "not built yet". That is deliberate over the alternatives —
 * routing somewhere that exists but is wrong would be a worse lie, and not
 * routing at all would leave the tap doing nothing. When the capture screen
 * lands, this needs no change; when a dedicated manual-entry route appears,
 * this constant is the one thing to repoint.
 */
const RECORD_ROUTE = '/(tabs)/camera' as const;

export async function initReminderNotifications(): Promise<void> {
  if (!isNotificationSupported()) return;
  // Idempotent: a second call during a fast refresh would otherwise stack a
  // second listener and book two follow-ups per reminder.
  if (teardown) return;

  const Notifications = await import('expo-notifications');

  // Reminders are the point of the feature, so they show even with the app
  // open. Anything else would leave a patient staring at the app that just
  // decided not to tell them.
  Notifications.setNotificationHandler({
    handleNotification: () =>
      Promise.resolve({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
  });

  const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
    if (notification.request.content.data?.kind !== REMINDER_KIND) return;
    void scheduleFollowUp();
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const { actionIdentifier } = response;
      const kind = response.notification.request.content.data?.kind;
      if (kind !== REMINDER_KIND && kind !== FOLLOW_UP_KIND) return;

      if (actionIdentifier === REMINDER_DONE_ACTION_ID) {
        void cancelPendingFollowUps();
        return;
      }

      if (actionIdentifier === REMINDER_SNOOZE_ACTION_ID) {
        // The nudge the user just postponed must not arrive anyway.
        void cancelPendingFollowUps();
        void snoozeReminder();
        return;
      }

      // A plain tap. The follow-up is redundant the moment the app is open on
      // the capture screen.
      void cancelPendingFollowUps();
      router.push(RECORD_ROUTE);
    },
  );

  teardown = () => {
    receivedSub.remove();
    responseSub.remove();
    teardown = null;
  };
}

export function stopReminderNotifications(): void {
  teardown?.();
}
