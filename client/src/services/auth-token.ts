/**
 * Auth token storage.
 *
 * SecureStore on native, AsyncStorage on web — SecureStore has no web
 * implementation and `expo start --web` has to keep working for development.
 * That means the web token is *not* encrypted at rest; web is a dev target
 * here, not a shipping one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from '@/config';

/**
 * SecureStore keys must match /^[A-Za-z0-9._-]+$/, so the original
 * "bp:auth-token" key could not move across as-is. The old key is still read
 * once, to migrate users who upgrade rather than reinstall.
 */
const LEGACY_TOKEN_KEY = LEGACY_STORAGE_KEYS.authToken;
const TOKEN_KEY = STORAGE_KEYS.authToken;

const useSecureStore = Platform.OS === 'ios' || Platform.OS === 'android';

async function removeLegacyToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Best-effort cleanup — failing to delete the old copy must not block login.
  }
}

export async function setAuthToken(token: string): Promise<void> {
  if (useSecureStore) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await removeLegacyToken();
    return;
  }
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function getAuthToken(): Promise<string | null> {
  if (!useSecureStore) return AsyncStorage.getItem(TOKEN_KEY);

  const secure = await SecureStore.getItemAsync(TOKEN_KEY);
  if (secure) return secure;

  // One-time migration from the pre-SecureStore build.
  const legacy = await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
  if (!legacy) return null;

  try {
    await SecureStore.setItemAsync(TOKEN_KEY, legacy);
  } finally {
    await removeLegacyToken();
  }
  return legacy;
}

export async function clearAuthToken(): Promise<void> {
  await forgetSessionUserId();

  if (useSecureStore) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await removeLegacyToken();
    return;
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/**
 * The token's owner, remembered across launches.
 *
 * Plain `AsyncStorage` rather than SecureStore: a user id is not a
 * credential, it is already all over the local database, and putting it
 * behind the keychain would buy nothing while adding a second thing that can
 * fail during a cold start. Cleared with the token, in `clearAuthToken`, so
 * the two can never disagree about whether there is a session.
 */
export async function rememberSessionUserId(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEYS.sessionUserId, userId);
  } catch {
    // Best effort. Losing this costs an offline launch its history, not the
    // session itself — never the sign-in.
  }
}

export async function getSessionUserId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.sessionUserId);
  } catch {
    return null;
  }
}

export async function forgetSessionUserId(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEYS.sessionUserId);
  } catch {
    // Same reasoning as `rememberSessionUserId`.
  }
}
