/**
 * The lazy loader for `expo-notifications`, shared by every service in this
 * module.
 *
 * Extracted from `reminder-service.ts` when a second consumer appeared
 * (`invite-notification.ts`). The laziness is the point and is easy to undo by
 * accident: Expo Go on Android dropped remote-push support in SDK 53, and
 * merely *importing* expo-notifications there fires an auto push-token
 * registration side effect that warns on every launch — for an app that only
 * ever posts local notifications. Loading on demand keeps that off the boot
 * path and lets the UI say `'unsupported'` honestly.
 *
 * A second module-level import elsewhere would defeat this for the whole app,
 * so services import the loader, never the package.
 */
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

export type NotificationsModule = typeof import('expo-notifications');

const isExpoGoAndroid =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient &&
  Platform.OS === 'android';

let cached: NotificationsModule | null | undefined;

export async function loadNotifications(): Promise<NotificationsModule | null> {
  if (cached !== undefined) return cached;
  if (isExpoGoAndroid) {
    cached = null;
    return null;
  }
  try {
    cached = await import('expo-notifications');
  } catch {
    cached = null;
  }
  return cached;
}

export function isNotificationSupported(): boolean {
  return !isExpoGoAndroid;
}
