/**
 * Reads a renamed AsyncStorage key, falling back to what it used to be
 * called.
 *
 * Renaming a key is invisible in testing — a fresh install writes the new
 * name and reads it back fine. The user who notices is the one who upgrades:
 * their theme, font size, and "setup done" flag are all under the old names,
 * so without this they land back on the defaults and are walked through
 * first-run setup again.
 *
 * The old copy is deleted on a successful fallback read, so this costs one
 * extra `getItem` per key exactly once per install.
 *
 * SecureStore is not covered here: it holds one key (the auth token), that
 * key's own migration predates this file, and its fallback is more involved
 * than a rename — see `services/auth-token.ts`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export async function readWithLegacyFallback(
  key: string,
  legacyKey: string,
): Promise<string | null> {
  const current = await AsyncStorage.getItem(key);
  if (current !== null) return current;

  const legacy = await AsyncStorage.getItem(legacyKey);
  if (legacy === null) return null;

  try {
    await AsyncStorage.setItem(key, legacy);
    await AsyncStorage.removeItem(legacyKey);
  } catch {
    // The value is in hand either way. Failing to rewrite it under the new
    // name just means this runs again next launch, which is harmless — the
    // alternative, throwing, would lose a preference we successfully read.
  }

  return legacy;
}
