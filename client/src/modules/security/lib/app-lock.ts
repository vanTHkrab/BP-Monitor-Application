/**
 * Device-local app lock: require the phone's own screen lock before the app
 * shows anything.
 *
 * Two decisions worth stating, because both are easy to get wrong in the
 * direction that looks safer:
 *
 * 1. **Off by default.** This app is used by patients who may be elderly or
 *    unwell, and a lock they did not ask for turns a blood-pressure log into
 *    something they cannot open. Security that gets an app abandoned is not
 *    security. It is one toggle away for anyone who wants it.
 *
 * 2. **It is not an authentication boundary.** The session token is what the
 *    server trusts; this only decides whether the UI is drawn. Someone with
 *    the device unlocked and a debugger attached is not stopped by it. What it
 *    does stop is the realistic case — a shared or briefly-borrowed phone.
 *    Treating it as more than that would justify skipping the server-side
 *    checks that actually matter.
 *
 * The preference lives in SecureStore rather than AsyncStorage. Not because
 * "true" is a secret, but because AsyncStorage on Android is world-readable to
 * anything with root or a backup extraction, and a setting whose whole purpose
 * is to resist local access should not be the easiest thing on the device to
 * flip.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

const APP_LOCK_KEY = 'bp.app_lock_enabled';

export type BiometricKind = 'face' | 'fingerprint' | 'iris' | 'passcode' | 'none';

export type BiometricCapability = {
  /** Hardware present *and* something enrolled. Either alone is not usable. */
  available: boolean;
  kind: BiometricKind;
  /** What to call it on screen, in Thai. */
  label: string;
};

export async function isAppLockEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(APP_LOCK_KEY)) === 'true';
  } catch {
    // A SecureStore read can fail on a device whose keystore is in a bad
    // state. Failing to "off" is deliberate: the alternative locks someone
    // out of their own health record because of a storage error.
    return false;
  }
}

export async function setAppLockEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(APP_LOCK_KEY, enabled ? 'true' : 'false');
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  const [hasHardware, isEnrolled, types] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    LocalAuthentication.supportedAuthenticationTypesAsync(),
  ]);

  if (!hasHardware || !isEnrolled) {
    return { available: false, kind: 'none', label: 'ระบบล็อกหน้าจอ' };
  }

  const { AuthenticationType } = LocalAuthentication;

  if (types.includes(AuthenticationType.FACIAL_RECOGNITION)) {
    return { available: true, kind: 'face', label: 'สแกนใบหน้า' };
  }
  if (types.includes(AuthenticationType.FINGERPRINT)) {
    return { available: true, kind: 'fingerprint', label: 'ลายนิ้วมือ' };
  }
  if (types.includes(AuthenticationType.IRIS)) {
    return { available: true, kind: 'iris', label: 'สแกนม่านตา' };
  }

  // Enrolled, but not with a modality this build recognises — a PIN or
  // pattern. Still a usable lock, so it must not report as unavailable.
  return { available: true, kind: 'passcode', label: 'รหัสปลดล็อกเครื่อง' };
}

/**
 * Prompts for the device lock.
 *
 * `disableDeviceFallback` is deliberately **false**: a fingerprint that stops
 * reading — wet hands, a bandage, a worn sensor — must not be the end of the
 * road, or the lock becomes a way to lose access to your own readings. The
 * device passcode is an acceptable second path precisely because this is a
 * local convenience gate and not the server's idea of who you are.
 */
export async function promptDeviceUnlock(reason: string): Promise<boolean> {
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'ยกเลิก',
    disableDeviceFallback: false,
  });

  return result.success;
}

/** Thai copy for the ways `authenticateAsync` can fail. */
export function biometricErrorMessage(error?: string): string {
  switch (error) {
    case 'authentication_failed':
      return 'ยืนยันตัวตนไม่ผ่าน กรุณาลองใหม่อีกครั้ง';
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
      return 'ยกเลิกการยืนยันตัวตนแล้ว';
    case 'not_available':
      return 'อุปกรณ์นี้ยังใช้การยืนยันตัวตนในแอปนี้ไม่ได้';
    case 'not_enrolled':
      return 'ยังไม่ได้ตั้งค่าการปลดล็อกในเครื่อง กรุณาตั้งค่าก่อน';
    case 'passcode_not_set':
      return 'ยังไม่ได้ตั้งรหัสปลดล็อกเครื่อง กรุณาตั้งค่าก่อน';
    case 'lockout':
      return 'ถูกล็อกชั่วคราวเพราะลองผิดหลายครั้ง กรุณาปลดล็อกเครื่องก่อน';
    default:
      return 'ยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  }
}
