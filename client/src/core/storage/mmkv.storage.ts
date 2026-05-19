// Fast KV facade — prefers react-native-mmkv when the native binding is
// available, falls back to AsyncStorage when it isn't.
//
// MMKV requires a Nitro Module compiled into the native binary, which the
// stock Expo Go app doesn't ship. Detection happens once at module load:
// if `createMMKV` throws (no native binding) we install an AsyncStorage
// shim so the same `kvStorage.*` calls keep working in Expo Go — just
// slower. Custom dev clients, EAS builds, and the .web bundle all get
// real MMKV.
//
// API is async even though MMKV itself is sync, so the AsyncStorage
// fallback can satisfy the same contract without forcing the caller to
// know which backend is in use.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { createMMKV as CreateMMKVFn } from "react-native-mmkv";

type MMKVInstance = ReturnType<typeof CreateMMKVFn>;

// `require()` instead of static `import` because react-native-mmkv pulls
// in the NitroModules native binding eagerly during module evaluation —
// a static import in Expo Go (no native binding) throws *before* control
// reaches any try/catch around `createMMKV()`. The dynamic require keeps
// both the module load and the instantiation inside the same try block.
const native: MMKVInstance | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-mmkv") as {
      createMMKV: typeof CreateMMKVFn;
    };
    return mod.createMMKV({ id: "bp-app" });
  } catch {
    if (__DEV__) {
      console.warn(
        "[storage] MMKV native module unavailable — falling back to " +
          "AsyncStorage. Expected in Expo Go; rebuild a custom dev client " +
          "(`pnpm android` / `pnpm ios`) to get MMKV performance.",
      );
    }
    return null;
  }
})();

const getStringRaw = async (key: string): Promise<string | undefined> => {
  if (native) return native.getString(key);
  const v = await AsyncStorage.getItem(key);
  return v ?? undefined;
};

const setStringRaw = async (key: string, value: string): Promise<void> => {
  if (native) {
    native.set(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
};

const deleteRaw = async (key: string): Promise<void> => {
  if (native) {
    native.remove(key);
    return;
  }
  await AsyncStorage.removeItem(key);
};

const hasRaw = async (key: string): Promise<boolean> => {
  if (native) return native.contains(key);
  const v = await AsyncStorage.getItem(key);
  return v !== null;
};

const getAllKeysRaw = async (): Promise<string[]> => {
  if (native) return native.getAllKeys();
  const keys = await AsyncStorage.getAllKeys();
  return [...keys];
};

export const kvStorage = {
  getString: getStringRaw,
  setString: setStringRaw,
  delete: deleteRaw,
  has: hasRaw,

  /** Enumerate every key in the store. Intended for dev/debug tools — most
   *  feature code should know the exact key it wants from `storage.keys.ts`. */
  getAllKeys: getAllKeysRaw,

  /** Returns parsed JSON, or `undefined` on missing/malformed entries. */
  getJSON: async <T>(key: string): Promise<T | undefined> => {
    const raw = await getStringRaw(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  },

  setJSON: async <T>(key: string, value: T): Promise<void> => {
    await setStringRaw(key, JSON.stringify(value));
  },
};

/** True when the MMKV native module is linked. Exposed for diagnostics
 *  (e.g. the debug page) — feature code shouldn't branch on this. */
export const isMMKVAvailable = native !== null;
