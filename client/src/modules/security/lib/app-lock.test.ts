/**
 * The device app lock.
 *
 * Two failure directions matter and they are not symmetric. Failing *open* is
 * a deliberate choice throughout — a keystore hiccup must not lock a patient
 * out of their own health record — so every "returns false on error" test here
 * is asserting a decision, not tolerating a bug. Failing *closed* would be the
 * regression.
 *
 * `AuthenticationType` comes from the real package rather than a hand-written
 * object: the members are numeric (FINGERPRINT 1, FACIAL_RECOGNITION 2,
 * IRIS 3) and a mock that invents them would let a wrong literal in the module
 * under test pass unnoticed.
 */
const mockSecureStore: {
  value: string | null;
  getError?: Error;
  setError?: Error;
  lastSet?: [string, string];
} = { value: null };

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => {
    if (mockSecureStore.getError) throw mockSecureStore.getError;
    return mockSecureStore.value;
  }),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    if (mockSecureStore.setError) throw mockSecureStore.setError;
    mockSecureStore.lastSet = [key, value];
    mockSecureStore.value = value;
  }),
}));

const mockHasHardware = jest.fn<Promise<boolean>, []>();
const mockIsEnrolled = jest.fn<Promise<boolean>, []>();
const mockSupportedTypes = jest.fn<Promise<number[]>, []>();
const mockAuthenticate = jest.fn();

jest.mock('expo-local-authentication', () => ({
  ...jest.requireActual('expo-local-authentication'),
  hasHardwareAsync: () => mockHasHardware(),
  isEnrolledAsync: () => mockIsEnrolled(),
  supportedAuthenticationTypesAsync: () => mockSupportedTypes(),
  authenticateAsync: (...args: unknown[]) => mockAuthenticate(...args),
}));

import { AuthenticationType } from 'expo-local-authentication';

import { STORAGE_KEYS } from '@/config';
import {
  biometricErrorMessage,
  getBiometricCapability,
  isAppLockEnabled,
  promptDeviceUnlock,
  setAppLockEnabled,
} from './app-lock';

beforeEach(() => {
  jest.clearAllMocks();
  mockSecureStore.value = null;
  delete mockSecureStore.getError;
  delete mockSecureStore.setError;
  delete mockSecureStore.lastSet;
  mockHasHardware.mockResolvedValue(true);
  mockIsEnrolled.mockResolvedValue(true);
  mockSupportedTypes.mockResolvedValue([]);
  mockAuthenticate.mockResolvedValue({ success: true });
});

describe('isAppLockEnabled', () => {
  it('is off by default, with nothing stored', async () => {
    await expect(isAppLockEnabled()).resolves.toBe(false);
  });

  it('is on only for the exact string "true"', async () => {
    mockSecureStore.value = 'true';
    await expect(isAppLockEnabled()).resolves.toBe(true);
  });

  it.each(['false', 'TRUE', '1', 'yes', ''])('is off for %p', async (stored) => {
    // A loose truthiness check here would turn any leftover value from an
    // older build into a lock the user never asked for.
    mockSecureStore.value = stored;
    await expect(isAppLockEnabled()).resolves.toBe(false);
  });

  it('fails open when the keystore is unreadable', async () => {
    mockSecureStore.getError = new Error('keystore in a bad state');
    await expect(isAppLockEnabled()).resolves.toBe(false);
  });
});

describe('setAppLockEnabled', () => {
  it.each([
    [true, 'true'],
    [false, 'false'],
  ])('stores %s as the string %p', async (enabled, written) => {
    await setAppLockEnabled(enabled);

    expect(mockSecureStore.lastSet).toEqual([STORAGE_KEYS.appLock, written]);
  });

  it('round-trips through isAppLockEnabled', async () => {
    await setAppLockEnabled(true);
    await expect(isAppLockEnabled()).resolves.toBe(true);

    await setAppLockEnabled(false);
    await expect(isAppLockEnabled()).resolves.toBe(false);
  });

  it('propagates a write failure rather than silently not saving', async () => {
    // Unlike the read, a failed *write* must surface: the settings screen has
    // to be able to tell the user the toggle did not take.
    mockSecureStore.setError = new Error('keystore in a bad state');

    await expect(setAppLockEnabled(true)).rejects.toThrow('keystore in a bad state');
  });
});

describe('getBiometricCapability', () => {
  it('is unavailable with no hardware', async () => {
    mockHasHardware.mockResolvedValue(false);
    mockIsEnrolled.mockResolvedValue(true);

    await expect(getBiometricCapability()).resolves.toEqual({
      available: false,
      kind: 'none',
      label: 'ระบบล็อกหน้าจอ',
    });
  });

  it('is unavailable with hardware but nothing enrolled', async () => {
    // Either alone is useless — prompting on an unenrolled sensor fails every
    // time and there is no way for the user to recover from inside the app.
    mockIsEnrolled.mockResolvedValue(false);
    mockSupportedTypes.mockResolvedValue([AuthenticationType.FINGERPRINT]);

    await expect(getBiometricCapability()).resolves.toMatchObject({
      available: false,
      kind: 'none',
    });
  });

  it.each([
    [AuthenticationType.FACIAL_RECOGNITION, 'face', 'สแกนใบหน้า'],
    [AuthenticationType.FINGERPRINT, 'fingerprint', 'ลายนิ้วมือ'],
    [AuthenticationType.IRIS, 'iris', 'สแกนม่านตา'],
  ])('reports %s as %s', async (type, kind, label) => {
    mockSupportedTypes.mockResolvedValue([type]);

    await expect(getBiometricCapability()).resolves.toEqual({ available: true, kind, label });
  });

  // Reversed by explicit user decision: fingerprint over face. Ordering is
  // the invariant under test, not the mere presence of a label — a device
  // enrolling both should name fingerprint in the prompt, not face.
  it('prefers fingerprint over face when both are enrolled', async () => {
    mockSupportedTypes.mockResolvedValue([
      AuthenticationType.FACIAL_RECOGNITION,
      AuthenticationType.FINGERPRINT,
      AuthenticationType.IRIS,
    ]);

    await expect(getBiometricCapability()).resolves.toMatchObject({ kind: 'fingerprint' });
  });

  it('prefers fingerprint over iris', async () => {
    mockSupportedTypes.mockResolvedValue([AuthenticationType.IRIS, AuthenticationType.FINGERPRINT]);

    await expect(getBiometricCapability()).resolves.toMatchObject({ kind: 'fingerprint' });
  });

  it('reports an enrolled-but-unrecognised modality as a usable passcode', async () => {
    // A PIN or pattern is still a lock. Reporting it unavailable would hide
    // the feature from every device without a biometric sensor.
    mockSupportedTypes.mockResolvedValue([99 as AuthenticationType]);

    await expect(getBiometricCapability()).resolves.toEqual({
      available: true,
      kind: 'passcode',
      label: 'รหัสปลดล็อกเครื่อง',
    });
  });

  it('reports a passcode when nothing at all is reported but enrolment says yes', async () => {
    mockSupportedTypes.mockResolvedValue([]);

    await expect(getBiometricCapability()).resolves.toMatchObject({
      available: true,
      kind: 'passcode',
    });
  });
});

describe('promptDeviceUnlock', () => {
  it('passes exactly the prompt options the module commits to', async () => {
    await promptDeviceUnlock('ปลดล็อกเพื่อดูข้อมูล');

    // `disableDeviceFallback: false` is the load-bearing one: flipping it to
    // true means a wet finger or a bandage locks someone out of their own
    // readings with no second path. toEqual so a new option cannot slip in.
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockAuthenticate.mock.calls[0][0]).toEqual({
      promptMessage: 'ปลดล็อกเพื่อดูข้อมูล',
      cancelLabel: 'ยกเลิก',
      disableDeviceFallback: false,
    });
  });

  it.each([true, false])('returns the success flag verbatim (%s)', async (success) => {
    mockAuthenticate.mockResolvedValue({ success });

    await expect(promptDeviceUnlock('reason')).resolves.toBe(success);
  });

  it('returns false when the result carries an error code', async () => {
    mockAuthenticate.mockResolvedValue({ success: false, error: 'user_cancel' });

    await expect(promptDeviceUnlock('reason')).resolves.toBe(false);
  });
});

describe('biometricErrorMessage', () => {
  it.each([
    ['authentication_failed', 'ยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่อีกครั้ง'],
    ['user_cancel', 'ยกเลิกการยืนยันตัวตนแล้ว'],
    ['app_cancel', 'ยกเลิกการยืนยันตัวตนแล้ว'],
    ['system_cancel', 'ยกเลิกการยืนยันตัวตนแล้ว'],
    ['not_available', 'อุปกรณ์นี้ยังใช้การยืนยันตัวตนในแอปนี้ไม่ได้'],
    ['not_enrolled', 'ยังไม่ได้ตั้งค่าการปลดล็อกในเครื่อง กรุณาตั้งค่าก่อน'],
    ['passcode_not_set', 'ยังไม่ได้ตั้งรหัสปลดล็อกเครื่อง กรุณาตั้งค่าก่อน'],
    ['lockout', 'ถูกล็อกชั่วคราวเพราะลองผิดหลายครั้ง กรุณาปลดล็อกเครื่องก่อน'],
  ])('maps %s to its own copy', (code, message) => {
    expect(biometricErrorMessage(code)).toBe(message);
  });

  it('never leaks a raw code to the user', () => {
    expect(biometricErrorMessage('some_new_expo_code')).toBe(
      'ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    );
    expect(biometricErrorMessage(undefined)).toBe('ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    expect(biometricErrorMessage()).toBe('ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  });

  it('gives cancellation its own message, distinct from a failed attempt', () => {
    // The two are different events for the user: one is "you stopped", the
    // other is "the sensor did not recognise you".
    expect(biometricErrorMessage('user_cancel')).not.toBe(
      biometricErrorMessage('authentication_failed'),
    );
  });
});
