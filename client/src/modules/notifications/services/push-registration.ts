/**
 * Remote push: getting this installation an Expo token and telling the gateway
 * about it, so a caregiver's phone rings when their patient records a critical
 * reading (A-009).
 *
 * expo-notifications is reached through `loadNotifications()`, never imported
 * at the top of this file. The reason is written in `notifications-module.ts`
 * and it is easy to undo by accident: a single module-level import anywhere
 * re-arms Expo Go on Android's auto-registration side effect for the whole
 * app. That loader returning `null` is also the honest answer here — Expo Go
 * on Android cannot obtain a remote push token at all, so registration is a
 * no-op there rather than an error.
 *
 * > **This feature cannot be exercised in Expo Go.** A remote push token needs
 * > a development build (`pnpm expo run:android` / a dev-client build). In
 * > Expo Go every function in this file resolves to `'unsupported'` and sends
 * > nothing — which is correct behaviour, not a bug to debug.
 *
 * I/O only. The one decision that is worth testing on its own — what a push
 * payload means — lives in `lib/critical-alert.ts`.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS, pushDenialNoticeKey } from '@/config';
import { graphqlRequest } from '@/services/api';

import { loadNotifications, type NotificationsModule } from './notifications-module';
import { GQL_REGISTER_PUSH_TOKEN, GQL_UNREGISTER_PUSH_TOKEN } from './operations';

/**
 * What one attempt at registering ended up doing. Reported rather than thrown:
 * every branch except `'error'` is a normal state of the world, and three of
 * them are states the user chose.
 */
export type PushRegistrationOutcome =
  /** Registered, or already registered with the same token. */
  | 'registered'
  /** No remote push in this runtime — Expo Go on Android, or web. */
  | 'unsupported'
  /** Declined, and the OS will still show the prompt again. */
  | 'denied'
  /** Declined for good; only the system settings screen can undo it. */
  | 'blocked'
  /** Permitted, but the token or the gateway call failed. Retried next launch. */
  | 'error';

/**
 * The token this installation last successfully registered.
 *
 * Cached in memory *and* in AsyncStorage. Memory is the fast path; storage is
 * what makes logout work after a cold start, where nothing has asked the OS
 * for a token yet and asking may be impossible (offline, permission revoked).
 */
let cachedToken: string | null | undefined;

/**
 * Whether this launch has already run the OS permission prompt.
 *
 * The prompt is asked at most once per app session, and only on the first
 * authenticated launch that finds the permission undetermined — see
 * `syncPushRegistration`.
 */
let askedThisSession = false;

/** Test seam. Nothing in the app should need this. */
export function resetPushRegistrationState(): void {
  cachedToken = undefined;
  askedThisSession = false;
}

export async function getRegisteredPushToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  try {
    cachedToken = await AsyncStorage.getItem(STORAGE_KEYS.pushToken);
  } catch {
    // Unreadable storage means "we do not know of a token", which is the same
    // thing the caller does with `null`. Nothing to repair.
    cachedToken = null;
  }
  return cachedToken;
}

async function rememberPushToken(token: string | null): Promise<void> {
  cachedToken = token;
  try {
    if (token) await AsyncStorage.setItem(STORAGE_KEYS.pushToken, token);
    else await AsyncStorage.removeItem(STORAGE_KEYS.pushToken);
  } catch {
    // The in-memory copy still carries this session. Losing the durable copy
    // costs a re-register on the next launch, not a wrong result.
  }
}

/**
 * Forgets the token locally. Called after a logout that already asked the
 * gateway to delete the row — the account is gone from this device, and a
 * stale token here would be sent as the *next* user's on their first logout.
 */
export async function forgetPushToken(): Promise<void> {
  await rememberPushToken(null);
}

/**
 * The EAS project id `getExpoPushTokenAsync` needs to mint a token for *this*
 * project.
 *
 * Read from the resolved app config rather than hardcoded: `app.json` owns it
 * (`expo.extra.eas.projectId`), and a second literal copy here would be a
 * silently divergent one the day the project is moved or re-created.
 * `easConfig` is the fallback shape older/other runtimes expose.
 */
function getEasProjectId(): string | undefined {
  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExtra === 'string' && fromExtra) return fromExtra;

  const fromEasConfig = Constants.easConfig?.projectId;
  return typeof fromEasConfig === 'string' && fromEasConfig ? fromEasConfig : undefined;
}

/**
 * What the user will see in the gateway's device list.
 *
 * `deviceName` is what the owner named the handset ("iPhone ของสมชาย") and is
 * the only label that helps someone recognise a row; `modelName` is the
 * fallback when the OS withholds it.
 */
function deviceLabel(): string | undefined {
  return Device.deviceName ?? Device.modelName ?? undefined;
}

/**
 * The gateway validates `platform` with `IsIn(['ios', 'android'])`, so web
 * must send nothing rather than `'web'` — an omitted optional field is
 * accepted, an unrecognised one fails the whole mutation.
 */
function platformArg(): 'ios' | 'android' | undefined {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return undefined;
}

/**
 * Critical BP alerts get their own Android channel.
 *
 * Android's per-channel switches are the only controls the user actually gets.
 * A caregiver who mutes measurement reminders must not thereby mute the one
 * notification the whole feature exists for, so this cannot share a channel
 * with reminders or with invites. `MAX` importance because the alternative to
 * a heads-up banner here is a patient's critical reading sitting silently in
 * a tray.
 */
const CRITICAL_CHANNEL_ID = 'bp_critical_alerts';

async function ensureCriticalChannel(Notifications: NotificationsModule): Promise<void> {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(CRITICAL_CHANNEL_ID, {
    name: 'แจ้งเตือนค่าความดันวิกฤต',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 300, 200, 300],
    lightColor: '#E5484D',
  });
}

type PermissionOutcome = 'granted' | 'denied' | 'blocked';

/**
 * Resolves the notification permission, prompting at most once.
 *
 * `ask` is false on every path except the first authenticated launch that
 * finds the permission undetermined. That restraint is the same one
 * `reminder-service.ts` documents: on Android 13+ `POST_NOTIFICATIONS` is a
 * one-shot runtime permission, and a denial makes `canAskAgain` false forever.
 * Asking here is a deliberate trade — it lands immediately after sign-in,
 * which is the closest this feature gets to a moment the user can connect the
 * prompt to — and it is never repeated.
 */
async function resolvePermission(
  Notifications: NotificationsModule,
  ask: boolean,
): Promise<PermissionOutcome> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'blocked';
  if (!ask) return 'denied';

  const requested = await Notifications.requestPermissionsAsync();
  if (requested.granted) return 'granted';
  return requested.canAskAgain ? 'denied' : 'blocked';
}

/**
 * Says once, calmly, that critical alerts will not arrive — and offers the one
 * thing that fixes it.
 *
 * An `Alert` rather than a toast because it is a decision ("open settings?"),
 * not a report, which is the line `components/ui/app-toast.tsx` draws. Guarded
 * by a per-user flag so it is said exactly once per account per device: a
 * launch-time reminder that you declined a permission is a nag, and a nagged
 * user does not grant the permission, they mute the app.
 */
async function explainDenialOnce(userId: string): Promise<void> {
  const key = pushDenialNoticeKey(userId);

  try {
    if (await AsyncStorage.getItem(key)) return;
    await AsyncStorage.setItem(key, '1');
  } catch {
    // Storage is unavailable. Saying nothing is better than risking saying it
    // on every launch, which is the failure this guard exists to prevent.
    return;
  }

  Alert.alert(
    'การแจ้งเตือนถูกปิดอยู่',
    'ตอนนี้เราจะไม่สามารถแจ้งคุณได้เมื่อมีค่าความดันในระดับวิกฤต หากต้องการรับการแจ้งเตือน เปิดได้ที่การตั้งค่าของเครื่อง',
    [
      { text: 'ไว้ภายหลัง', style: 'cancel' },
      { text: 'เปิดการตั้งค่า', onPress: () => void Linking.openSettings() },
    ],
  );
}

/**
 * Drops a token the gateway still believes in but the OS no longer honours.
 *
 * Without this, permission revoked from system settings leaves a live row on
 * the server: the gateway keeps addressing a token that will never deliver,
 * and only learns otherwise from Expo's `DeviceNotRegistered` receipts. Best
 * effort — a failure here just means we try again next launch.
 */
async function unregisterStaleToken(): Promise<void> {
  const token = await getRegisteredPushToken();
  if (!token) return;

  try {
    await graphqlRequest<{ unregisterPushToken: boolean }>(GQL_UNREGISTER_PUSH_TOKEN, {
      token,
    });
  } catch {
    // Offline, or the session went away underneath us. The local copy is
    // cleared regardless: this device is not receiving push either way, and
    // keeping a token we know is dead would send it as the next logout's
    // argument.
  }

  await forgetPushToken();
}

/**
 * Brings the gateway's idea of this installation in line with the OS's.
 *
 * Called for the signed-in user on every launch and on every sign-in — see
 * `bootstrap.ts`. Safe to call repeatedly: `registerPushToken` upserts on the
 * gateway, so a repeat is a no-op there rather than a duplicate row.
 *
 * Never throws. A push token the app failed to register is a degraded
 * notification experience, not a reason for a launch to fail.
 */
export async function syncPushRegistration(userId: string): Promise<PushRegistrationOutcome> {
  const Notifications = await loadNotifications();
  // Expo Go on Android, or a runtime without the package. No token, no error,
  // no scary UI — and deliberately no denial notice either, because nothing
  // here is the user's doing.
  if (!Notifications) return 'unsupported';

  try {
    const ask = !askedThisSession;
    askedThisSession = true;

    const permission = await resolvePermission(Notifications, ask);

    if (permission !== 'granted') {
      await unregisterStaleToken();
      await explainDenialOnce(userId);
      return permission;
    }

    await ensureCriticalChannel(Notifications);

    const projectId = getEasProjectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    await graphqlRequest<{ registerPushToken: boolean }>(GQL_REGISTER_PUSH_TOKEN, {
      input: {
        token,
        deviceLabel: deviceLabel(),
        platform: platformArg(),
      },
    });

    await rememberPushToken(token);
    return 'registered';
  } catch {
    // Emulator without Google Play services, no network, a project id the
    // Expo push service rejects. All of them recover on the next launch, and
    // none of them is worth interrupting the user over — they did not ask for
    // this and cannot act on it.
    return 'error';
  }
}
