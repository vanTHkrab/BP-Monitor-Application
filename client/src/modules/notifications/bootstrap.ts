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
import {
  isNotificationSupported,
  loadNotifications,
} from './services/notifications-module';
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
 * The in-flight `initReminderNotifications` call, if one has not finished.
 *
 * `teardown` alone cannot guard re-entry, because it is only assigned *after*
 * the dynamic import resolves: two calls entering before that both see `null`
 * and both register a listener, of which only the second is ever removable.
 * A React 19 double-mount, a Fast Refresh, or any remount of the effect in
 * `app/_layout.tsx` is enough. The symptom is two follow-ups booked per
 * delivered reminder — exactly what the guard exists to prevent.
 */
let initInFlight: Promise<void> | null = null;

/**
 * Installs the foreground presentation handler at *import* time.
 *
 * Not from `initReminderNotifications`, and the difference is not cosmetic.
 * Until a handler is registered, expo-notifications' `HandlerModule` is not a
 * presentation delegate, so iOS takes the `completionHandler([])` fallthrough
 * and presents the notification with **no** options: no banner, no sound, no
 * entry in the list. The notification is silently swallowed. Worse, the
 * *received* listener still fires — `EmitterModule` is a delegate from
 * `OnCreate` — so JS believes a notification arrived that the user never saw.
 *
 * Registering it from an effect put that window after React had mounted. This
 * moves it to bundle evaluation, which is the earliest this module can act.
 *
 * It cannot be earlier, and it cannot be a static import: importing
 * `expo-notifications` at module scope re-arms the Expo Go auto-registration
 * side effect for the whole app — the reason `notifications-module.ts` exists.
 * So a window remains, bounded by how long the dynamic import takes rather
 * than by React's mount. Closing it entirely would need the static import the
 * loader is written to avoid.
 *
 * > **SDK 58 changes this default.** Foregrounded notifications will be shown
 * > without a handler. This code will still be correct — it asks for banner,
 * > list, and sound explicitly — but the failure it guards against disappears.
 */
const handlerInstalled = (async () => {
  const Notifications = await loadNotifications();
  if (!Notifications) return;

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
})();

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

/**
 * What one notification response means, independent of how it reached us.
 *
 * Extracted so the live listener and the cold-start replay below cannot
 * drift. They are two arrivals of the same event: a tap that lands while the
 * app is running raises the listener, and a tap that *starts* the app is
 * retained natively and read back by `getLastNotificationResponse()`. A copy
 * of this dispatch in each would be a routing table that is correct on warm
 * start and subtly wrong on cold — the case nobody tests, because reproducing
 * it means killing the app first.
 */
function dispatchNotificationResponse(
  response: import('expo-notifications').NotificationResponse,
): void {
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
}

export function initReminderNotifications(): Promise<void> {
  if (!isNotificationSupported()) return Promise.resolve();
  // Idempotent, and the latch is taken *before* the first await — see
  // `initInFlight`. Guarding on `teardown` alone leaks a listener.
  if (teardown) return Promise.resolve();
  if (initInFlight) return initInFlight;

  initInFlight = (async () => {
    const Notifications = await loadNotifications();
    if (!Notifications) return;

    // The handler is already installed at import time; this only waits for it
    // so a caller that awaits init cannot observe a half-configured module.
    await handlerInstalled;

    const receivedSub = Notifications.addNotificationReceivedListener(
      (notification) => {
        if (notification.request.content.data?.kind !== REMINDER_KIND) return;
        void scheduleFollowUp();
      },
    );

    const responseSub =
      Notifications.addNotificationResponseReceivedListener(
        dispatchNotificationResponse,
      );

    teardown = () => {
      receivedSub.remove();
      responseSub.remove();
      teardown = null;
    };
  })();

  // Cleared either way: a failed init must not latch the module shut, or the
  // next mount silently gets no listeners at all.
  void initInFlight.finally(() => {
    initInFlight = null;
  });

  return initInFlight;
}

export function stopReminderNotifications(): void {
  teardown?.();
}

/**
 * Handles the notification tap that *started* the app, if there was one.
 *
 * The live listener cannot catch this. `EmitterModule` emits the response
 * when the native module is created — before `await loadNotifications()` has
 * resolved — and Expo's emitter does not buffer for listeners that subscribe
 * later. The native `pendingResponses` queue replays only to *native*
 * delegates, not to a JS subscription. So a cold-start tap reaches JS through
 * exactly one door: the response the module retained, read back here.
 *
 * **Call this only once the navigator exists.** `app/_layout.tsx` renders
 * `<RootStack/>` behind `migrations.success`, and `router.push` before that
 * has no navigator to push onto. Being late is harmless — the response is
 * retained until read — while being early loses the route silently, which is
 * indistinguishable from the bug this function fixes.
 *
 * Cleared after dispatch so a later remount does not re-navigate the user to
 * a screen they have already left. `clearLastNotificationResponse` is the
 * synchronous SDK 57 form; the `…Async` variants are deprecated.
 */
export async function consumeInitialNotificationResponse(): Promise<void> {
  if (!isNotificationSupported()) return;

  const Notifications = await loadNotifications();
  if (!Notifications) return;

  const response = Notifications.getLastNotificationResponse();
  if (!response) return;

  Notifications.clearLastNotificationResponse();
  dispatchNotificationResponse(response);
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
