/**
 * Which method signed in last, remembered on the device.
 *
 * The gateway also stores this (`User.lastLoginMethod`), and that copy is the
 * one the security screen shows. This one exists because the *login* screen
 * needs it before anyone is authenticated: there is no session to ask, and
 * asking the server "which method does this phone number use" would answer a
 * question about an account to whoever typed the number.
 *
 * So the hint is device-local by necessity, not by preference. It is also only
 * a hint — it reorders and labels the buttons, and nothing else reads it. A
 * wrong or missing value costs one extra tap.
 *
 * AsyncStorage rather than SecureStore: knowing that this phone last used
 * Google is not a credential, and SecureStore on Android goes through the
 * keystore, which is a lot of ceremony for a UI hint that must never delay
 * the sign-in screen's first paint.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bp.last_login_method';

export type LastLoginMethod = 'password' | 'google' | 'passkey';

const VALID: LastLoginMethod[] = ['password', 'google', 'passkey'];

export async function readLastLoginMethod(): Promise<LastLoginMethod | null> {
  try {
    const value = await AsyncStorage.getItem(KEY);
    return (VALID as string[]).includes(value ?? '') ? (value as LastLoginMethod) : null;
  } catch {
    // A hint that fails to load is a hint that is absent. Never a blocker.
    return null;
  }
}

export async function writeLastLoginMethod(method: LastLoginMethod): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, method);
  } catch {
    // As above — failing to remember costs the user one tap next time.
  }
}
