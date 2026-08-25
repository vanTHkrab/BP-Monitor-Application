/**
 * Registering this installation for remote push — and the three ways it is
 * supposed to do nothing.
 *
 * Every branch here is invisible in a happy-path run and load-bearing in the
 * field. Registering with the wrong variables means the gateway holds a row it
 * can never deliver to. Throwing on Expo Go means a launch that crashes on a
 * runtime that was never going to support the feature. Nagging a user who
 * declined is how an app gets muted at the OS level, after which it delivers
 * nothing at all — including the critical reading the feature exists for.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

// `mock` prefix required: jest hoists these factories above the declarations,
// and the wrapper functions are what let the factory close over a spy that is
// still `undefined` when the factory itself runs.
const mockGraphqlRequest = jest.fn();
jest.mock('@/services/api', () => ({
  graphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
}));

const mockLoadNotifications = jest.fn();
jest.mock('./notifications-module', () => ({
  loadNotifications: () => mockLoadNotifications(),
}));

jest.mock('expo-device', () => ({ deviceName: 'Pixel 8', modelName: 'Pixel 8' }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';

import { pushDenialNoticeKey, STORAGE_KEYS } from '@/config';

import { GQL_REGISTER_PUSH_TOKEN, GQL_UNREGISTER_PUSH_TOKEN } from './operations';
import {
  forgetPushToken,
  getRegisteredPushToken,
  resetPushRegistrationState,
  syncPushRegistration,
} from './push-registration';

const USER = 'u1';
const TOKEN = 'ExponentPushToken[abc123]';

/** Enough of expo-notifications for this file. Permission is the only knob. */
const notificationsModule = (permission: {
  granted: boolean;
  canAskAgain: boolean;
  onRequest?: { granted: boolean; canAskAgain: boolean };
}) => ({
  getPermissionsAsync: jest.fn().mockResolvedValue(permission),
  requestPermissionsAsync: jest
    .fn()
    .mockResolvedValue(permission.onRequest ?? permission),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: TOKEN }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  // Returns a real subscription shape rather than `undefined`: the module
  // holds what this returns and calls `.remove()` on reset, so a bare
  // `jest.fn()` would fail there instead of here.
  addPushTokenListener: jest
    .fn()
    .mockReturnValue({ remove: jest.fn() }),
  AndroidImportance: { MAX: 5 },
});

/** Fires the rotation listener the module armed, the way the OS would. */
const rotateDeviceToken = (
  stub: ReturnType<typeof notificationsModule>,
  devicePushToken = { data: 'fcm-token-2', type: 'android' },
) => {
  const listener = stub.addPushTokenListener.mock.calls[0]?.[0] as
    | ((token: unknown) => void)
    | undefined;
  listener?.(devicePushToken);
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetPushRegistrationState();
  mockGraphqlRequest.mockResolvedValue({});
});

describe('syncPushRegistration', () => {
  it('sends the token and this device to the gateway once permission is granted', async () => {
    mockLoadNotifications.mockResolvedValue(
      notificationsModule({ granted: true, canAskAgain: true }),
    );

    const outcome = await syncPushRegistration(USER);

    expect(outcome).toBe('registered');
    expect(mockGraphqlRequest).toHaveBeenCalledWith(GQL_REGISTER_PUSH_TOKEN, {
      input: {
        token: TOKEN,
        deviceLabel: 'Pixel 8',
        // `Platform.OS` is 'ios' under jest-expo's default preset. The point
        // of the assertion is that a value the gateway's `IsIn(['ios',
        // 'android'])` accepts is what goes on the wire.
        platform: 'ios',
      },
    });
  });

  it('remembers the registered token so logout can name the row to delete', async () => {
    mockLoadNotifications.mockResolvedValue(
      notificationsModule({ granted: true, canAskAgain: true }),
    );

    await syncPushRegistration(USER);
    resetPushRegistrationState();

    await expect(getRegisteredPushToken()).resolves.toBe(TOKEN);
  });

  /**
   * Expo Go on Android: `loadNotifications()` resolves to `null` by design.
   * Nothing to register, and nothing the user did wrong — so no request, no
   * throw, and pointedly no message about permissions.
   */
  it('registers nothing and throws nothing where remote push does not exist', async () => {
    mockLoadNotifications.mockResolvedValue(null);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    await expect(syncPushRegistration(USER)).resolves.toBe('unsupported');

    expect(mockGraphqlRequest).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('registers nothing when the user declines, and says so once', async () => {
    mockLoadNotifications.mockResolvedValue(
      notificationsModule({
        granted: false,
        canAskAgain: true,
        onRequest: { granted: false, canAskAgain: true },
      }),
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    await expect(syncPushRegistration(USER)).resolves.toBe('denied');

    expect(mockGraphqlRequest).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    // Calm and specific: what stops working, and where to turn it back on.
    expect(alert.mock.calls[0][0]).toBe('การแจ้งเตือนถูกปิดอยู่');
    expect(alert.mock.calls[0][1]).toContain('วิกฤต');
  });

  it('does not repeat the notice on a later launch', async () => {
    mockLoadNotifications.mockResolvedValue(
      notificationsModule({ granted: false, canAskAgain: false }),
    );
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    await syncPushRegistration(USER);
    // A relaunch: module state is gone, the persisted flag is not.
    resetPushRegistrationState();
    await syncPushRegistration(USER);

    expect(alert).toHaveBeenCalledTimes(1);
    await expect(
      AsyncStorage.getItem(pushDenialNoticeKey(USER)),
    ).resolves.not.toBeNull();
  });

  /**
   * Permission revoked from system settings on a device that had registered.
   * Left alone, the gateway keeps addressing a token that will never deliver.
   */
  it('drops a token the OS no longer honours', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.pushToken, TOKEN);
    mockLoadNotifications.mockResolvedValue(
      notificationsModule({ granted: false, canAskAgain: false }),
    );
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    await expect(syncPushRegistration(USER)).resolves.toBe('blocked');

    expect(mockGraphqlRequest).toHaveBeenCalledWith(GQL_UNREGISTER_PUSH_TOKEN, {
      token: TOKEN,
    });
    await expect(getRegisteredPushToken()).resolves.toBeNull();
  });

  /**
   * Simulator without Play services, no network, a project id Expo rejects.
   * All recover next launch; none is worth failing a launch over.
   */
  it('reports an error rather than throwing when the token cannot be minted', async () => {
    const Notifications = notificationsModule({ granted: true, canAskAgain: true });
    Notifications.getExpoPushTokenAsync.mockRejectedValue(new Error('no play services'));
    mockLoadNotifications.mockResolvedValue(Notifications);

    await expect(syncPushRegistration(USER)).resolves.toBe('error');
  });
});

describe('forgetPushToken', () => {
  it('clears the durable copy so the next account does not inherit it', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.pushToken, TOKEN);

    await forgetPushToken();
    resetPushRegistrationState();

    await expect(getRegisteredPushToken()).resolves.toBeNull();
  });
});

/**
 * The push service can roll a token while the app is running, at which point
 * the old one is dead and the gateway is still addressing it. Nothing here is
 * observable without provoking it: a rotation that is missed looks exactly
 * like a caregiver whose patient happened not to record anything.
 */
describe('push token rotation', () => {
  const ROTATED = 'ExponentPushToken[rotated]';

  it('re-registers the new token against the signed-in user', async () => {
    const stub = notificationsModule({ granted: true, canAskAgain: false });
    mockLoadNotifications.mockResolvedValue(stub);

    await syncPushRegistration(USER);
    stub.getExpoPushTokenAsync.mockResolvedValue({ data: ROTATED });
    mockGraphqlRequest.mockClear();

    rotateDeviceToken(stub);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockGraphqlRequest).toHaveBeenCalledWith(
      GQL_REGISTER_PUSH_TOKEN,
      expect.objectContaining({
        input: expect.objectContaining({ token: ROTATED }),
      }),
    );
    await expect(getRegisteredPushToken()).resolves.toBe(ROTATED);
  });

  it('passes the device token it was handed straight back through', async () => {
    // The loop the API's own JSDoc warns about: without this option
    // `getExpoPushTokenAsync` calls `getDevicePushTokenAsync`, which is what
    // raises this listener in the first place.
    const stub = notificationsModule({ granted: true, canAskAgain: false });
    mockLoadNotifications.mockResolvedValue(stub);

    await syncPushRegistration(USER);
    stub.getExpoPushTokenAsync.mockClear();

    const devicePushToken = { data: 'fcm-token-2', type: 'android' };
    rotateDeviceToken(stub, devicePushToken);
    await Promise.resolve();

    expect(stub.getExpoPushTokenAsync).toHaveBeenCalledWith(
      expect.objectContaining({ devicePushToken }),
    );
  });

  it('does nothing after sign-out', async () => {
    // The listener outlives the session on purpose — the next sign-in on this
    // handset wants it already armed. What must not happen is a rotation
    // re-registering the device against the account that just left.
    const stub = notificationsModule({ granted: true, canAskAgain: false });
    mockLoadNotifications.mockResolvedValue(stub);

    await syncPushRegistration(USER);
    await forgetPushToken();
    mockGraphqlRequest.mockClear();

    rotateDeviceToken(stub);
    await Promise.resolve();

    expect(mockGraphqlRequest).not.toHaveBeenCalled();
  });

  it('arms the listener once, not once per sign-in', async () => {
    const stub = notificationsModule({ granted: true, canAskAgain: false });
    mockLoadNotifications.mockResolvedValue(stub);

    await syncPushRegistration(USER);
    await syncPushRegistration('u2');

    expect(stub.addPushTokenListener).toHaveBeenCalledTimes(1);
  });
});

/**
 * Reclaiming a row the previous account left behind.
 *
 * A logout whose server revoke failed leaves the `PushToken` row owned by
 * whoever signed out. The next user normally takes it over by registering —
 * but refusing the permission prompt used to skip registration entirely, so
 * the handset kept receiving a stranger's critical alerts with nothing able
 * to stop it. `POST_NOTIFICATIONS` gates display, not FCM registration, so on
 * Android the token is still live and still worth claiming.
 *
 * `Platform.OS` is redefined rather than mocked at the module level: the
 * suite's default is iOS, which is what the "drops a token the OS no longer
 * honours" case above exercises, and both branches need to stay covered.
 */
describe('registration when permission is refused', () => {
  const onAndroid = async (fn: () => Promise<void>) => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', {
      value: 'android',
      configurable: true,
    });
    try {
      await fn();
    } finally {
      Object.defineProperty(Platform, 'OS', {
        value: original,
        configurable: true,
      });
    }
  };

  it('still claims the row on Android, so the previous account loses it', async () => {
    await onAndroid(async () => {
      const stub = notificationsModule({ granted: false, canAskAgain: false });
      mockLoadNotifications.mockResolvedValue(stub);
      jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      await expect(syncPushRegistration(USER)).resolves.toBe('blocked');

      expect(mockGraphqlRequest).toHaveBeenCalledWith(
        GQL_REGISTER_PUSH_TOKEN,
        expect.objectContaining({
          input: expect.objectContaining({ token: TOKEN }),
        }),
      );
      // The opposite of what this path used to do. Unregistering here would
      // undo the claim in the same breath.
      expect(mockGraphqlRequest).not.toHaveBeenCalledWith(
        GQL_UNREGISTER_PUSH_TOKEN,
        expect.anything(),
      );
    });
  });

  it('creates the critical channel before minting', async () => {
    // Firebase: an app that creates its first channel while backgrounded gets
    // neither a shown notification nor a prompt until it is next opened. The
    // user may grant permission later without this code running again.
    await onAndroid(async () => {
      const stub = notificationsModule({ granted: false, canAskAgain: false });
      mockLoadNotifications.mockResolvedValue(stub);
      jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      await syncPushRegistration(USER);

      const channelAt =
        stub.setNotificationChannelAsync.mock.invocationCallOrder[0];
      const mintAt = stub.getExpoPushTokenAsync.mock.invocationCallOrder[0];
      expect(channelAt).toBeLessThan(mintAt);
    });
  });

  it('reports the refusal, not a success', async () => {
    // The outcome describes the permission, which is what the caller and the
    // denial notice key off. Claiming the row does not make this 'registered'.
    await onAndroid(async () => {
      mockLoadNotifications.mockResolvedValue(
        notificationsModule({
          granted: false,
          canAskAgain: true,
          onRequest: { granted: false, canAskAgain: true },
        }),
      );
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      await expect(syncPushRegistration(USER)).resolves.toBe('denied');
      expect(alert).toHaveBeenCalledTimes(1);
    });
  });

  it('survives a mint that fails on a device without Play services', async () => {
    await onAndroid(async () => {
      const stub = notificationsModule({ granted: false, canAskAgain: false });
      stub.getExpoPushTokenAsync.mockRejectedValue(new Error('no play services'));
      mockLoadNotifications.mockResolvedValue(stub);
      jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

      // Still the permission outcome, not 'error': the claim is opportunistic
      // and its failure leaves the row exactly as it already was.
      await expect(syncPushRegistration(USER)).resolves.toBe('blocked');
    });
  });
});
