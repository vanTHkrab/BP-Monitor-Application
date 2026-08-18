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

import { useAuthStore } from '@/stores';

import { parseCriticalAlert } from './lib/critical-alert';
import { handleCriticalAlertResponse } from './services/critical-alert-handler';
import { INVITE_KIND } from './services/invite-notification';
import { isNotificationSupported } from './services/notifications-module';
import { syncPushRegistration } from './services/push-registration';
import {
  cancelPendingFollowUps,
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

/** Where a caregiver-invite notification lands: the screen that answers it. */
const INVITE_ROUTE = '/invitations' as const;

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
      const data = response.notification.request.content.data;
      const kind = data?.kind;

      // A remote push, not one of ours. Checked first and by payload shape
      // rather than by `kind`: the gateway stamps `type`, the local
      // notifications stamp `kind`, so the two vocabularies cannot collide.
      // Handling it here rather than from a second listener for the same
      // reason the invite branch is here — a second response listener would
      // double-handle every reminder tap.
      if (parseCriticalAlert(data)) {
        handleCriticalAlertResponse(data);
        return;
      }

      // A caregiver invite. Routed here rather than from the caregivers module
      // because this is the app's only notification-response listener, and a
      // second one would double-handle every reminder tap.
      if (kind === INVITE_KIND) {
        router.push(INVITE_ROUTE);
        return;
      }

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

/**
 * Registers this installation for remote push whenever a user is signed in.
 *
 * ## Why an auth-store subscription rather than a new lifecycle
 *
 * A push token is only useful once there is a session to attach it to, and the
 * app already has exactly one place that reacts to becoming authenticated:
 * a `useAuthStore.subscribe` registered once at root, which is how
 * `registerSessionUserMirror` keeps the remembered user id in step. This is
 * the same shape for the same reason — the alternative is a list of five
 * sign-in paths (password, register, Google, passkey, restore) that a sixth
 * one forgets to join, and the failure would be a caregiver who quietly stops
 * receiving alerts.
 *
 * It also covers relaunch for free without a second mechanism: `initAuth`
 * calls `signedIn` after restoring the token, and this is registered before
 * that runs, so a cold start with a valid session is just another transition.
 *
 * **Deliberately not an `AppState` or `NetInfo` listener.**
 * `readings/hooks/use-readings-sync.tsx` owns the app's only ones
 * (`client/AGENTS.md`), and registration does not need them: the gateway
 * upserts, so "once per launch and once per sign-in" is enough and a
 * foreground-driven retry would only add prompts.
 *
 * Runs after sign-out too — as a no-op. `syncPushRegistration` needs a session
 * for its guarded mutation, and `userId` is null by then; the token is dropped
 * on the logout path instead, where the gateway is still willing to listen.
 */
export function registerPushNotifications(): () => void {
  const start = (userId: string | null) => {
    if (!userId) return;
    void syncPushRegistration(userId);
  };

  // The session may already be restored — `initAuth` resolves on its own
  // schedule and a subscription alone would miss a sign-in that landed first.
  start(useAuthStore.getState().userId);

  return useAuthStore.subscribe((state, previous) => {
    if (state.userId === previous.userId) return;
    start(state.userId);
  });
}
