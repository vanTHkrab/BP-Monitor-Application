import type {
  ExpoPushMessage,
  ExpoPushReceipt,
  ExpoPushReceiptId,
  ExpoPushTicket,
} from 'expo-server-sdk';

/**
 * DI token for the Expo push client.
 *
 * The client is injected rather than constructed inside `PushService` for two
 * reasons. The obvious one: every unit test would otherwise be one careless
 * `await` away from a real HTTPS call to Expo's servers.
 *
 * The less obvious one is why this file holds only the token and the
 * interface, with the concrete client in
 * [expo-push.provider.ts](./expo-push.provider.ts). `expo-server-sdk` v7 is
 * ESM-only and the Jest setup here is CJS, so *importing it at runtime* from
 * anything a spec loads fails to parse before a single test runs. Keeping the
 * import in a file no spec touches is the same split `auth/android-origin.ts`
 * uses against `better-auth` — see AGENTS.md. The imports above are
 * `import type`, which the compiler erases entirely.
 */
export const EXPO_PUSH_CLIENT = 'EXPO_PUSH_CLIENT';

/**
 * The surface `PushService` actually uses — narrower than `Expo` on purpose.
 * A test double only has to implement these five methods, and widening it is
 * then a deliberate edit rather than an accident.
 */
export interface ExpoPushClient {
  /**
   * On the instance here, though it is `Expo.isExpoPushToken` statically.
   * Registration has to validate the token format, and going through the
   * injected client is what keeps the ESM package out of the test's import
   * graph.
   */
  isExpoPushToken(token: unknown): boolean;
  sendPushNotificationsAsync(
    messages: ExpoPushMessage[],
  ): Promise<ExpoPushTicket[]>;
  getPushNotificationReceiptsAsync(
    receiptIds: ExpoPushReceiptId[],
  ): Promise<Record<string, ExpoPushReceipt>>;
  chunkPushNotifications(messages: ExpoPushMessage[]): ExpoPushMessage[][];
  chunkPushNotificationReceiptIds(
    receiptIds: ExpoPushReceiptId[],
  ): ExpoPushReceiptId[][];
}
