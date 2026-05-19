// Encrypted KV facade — wraps expo-secure-store.
//
// Use this for credentials only (auth token, refresh token, biometric
// salts). Anything non-sensitive belongs in `mmkv.storage.ts` — SecureStore
// goes through the platform keychain/keystore and is meaningfully slower.
//
// Native-only: SecureStore is unavailable on web. Calling these methods
// on web will throw whatever the underlying API throws — that's
// intentional, web is not a supported target for authenticated flows.

import * as SecureStore from "expo-secure-store";

export const secureStorage = {
  /** Returns the stored string, or `null` if the key is absent. */
  get: (key: string): Promise<string | null> =>
    SecureStore.getItemAsync(key),

  set: (key: string, value: string): Promise<void> =>
    SecureStore.setItemAsync(key, value),

  delete: (key: string): Promise<void> =>
    SecureStore.deleteItemAsync(key),
};
