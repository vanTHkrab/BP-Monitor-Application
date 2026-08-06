import { Expo } from 'expo-server-sdk';
import { EXPO_PUSH_CLIENT, type ExpoPushClient } from './expo-push.client';

/**
 * The only runtime import of `expo-server-sdk` in the codebase.
 *
 * `expo-server-sdk` v7 is ESM-only and the Jest setup here is CJS, so any
 * module a spec loads must not pull it in. Nothing imports this file except
 * `push.module.ts`, which no spec loads — the same isolation
 * `auth/android-origin.ts` uses for `better-auth`. If you import this from a
 * service, the whole suite stops parsing.
 */
export const expoPushClientProvider = {
  provide: EXPO_PUSH_CLIENT,
  useFactory: (): ExpoPushClient => {
    // `EXPO_ACCESS_TOKEN` is optional. Without it, Expo accepts a send from
    // anyone holding one of our push tokens; with it, only requests carrying
    // the project's token are honoured. Absent by design in development so a
    // fresh checkout can send; set it in production, where a leaked push
    // token should not be enough to notify our users.
    const accessToken = process.env.EXPO_ACCESS_TOKEN;
    const expo = new Expo(accessToken ? { accessToken } : {});

    return {
      // Static on the class, instance-level here — see `ExpoPushClient`.
      isExpoPushToken: (token: unknown) => Expo.isExpoPushToken(token),
      sendPushNotificationsAsync: (messages) =>
        expo.sendPushNotificationsAsync(messages),
      getPushNotificationReceiptsAsync: (receiptIds) =>
        expo.getPushNotificationReceiptsAsync(receiptIds),
      chunkPushNotifications: (messages) =>
        expo.chunkPushNotifications(messages),
      chunkPushNotificationReceiptIds: (receiptIds) =>
        expo.chunkPushNotificationReceiptIds(receiptIds),
    };
  },
};
