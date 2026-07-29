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

/**
 * SecureStore keys must match /^[A-Za-z0-9._-]+$/, so the original
 * "bp:auth-token" key could not move across as-is. The old key is still read
 * once, to migrate users who upgrade rather than reinstall.
 */
const LEGACY_TOKEN_KEY = 'bp:auth-token';
const TOKEN_KEY = 'bp_auth_token';

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
  if (useSecureStore) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await removeLegacyToken();
    return;
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
}
