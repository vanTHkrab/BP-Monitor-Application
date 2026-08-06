/**
 * App-lock state, shared by the settings row and the gate that enforces it.
 *
 * A Zustand store rather than component state because two unrelated places
 * read it — the toggle on `/security/app-lock` and the gate wrapping the whole
 * navigator — and a lock whose two halves disagree is worse than no lock.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

import {
  getBiometricCapability,
  isAppLockEnabled,
  promptDeviceUnlock,
  setAppLockEnabled,
  type BiometricCapability,
} from '../lib/app-lock';

type AppLockState = {
  /** Null until SecureStore has been read; the gate must not act before then. */
  enabled: boolean | null;
  /** True while the app is showing content. False means the gate is up. */
  unlocked: boolean;
  capability: BiometricCapability | null;
  hydrate: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  lock: () => void;
  unlock: () => void;
};

export const useAppLockStore = create<AppLockState>((set) => ({
  enabled: null,
  // Starts unlocked. The gate locks it once hydration says the feature is on —
  // starting locked would flash a lock screen at every user who never enabled
  // it, on every cold start.
  unlocked: true,
  capability: null,

  hydrate: async () => {
    const [enabled, capability] = await Promise.all([
      isAppLockEnabled(),
      getBiometricCapability(),
    ]);

    // A lock that was enabled and then had its screen lock removed at the OS
    // level would be unopenable. Treat it as off rather than trapping the user
    // outside their own data.
    const usable = enabled && capability.available;

    set({ enabled: usable, capability, unlocked: !usable });
  },

  setEnabled: async (enabled) => {
    await setAppLockEnabled(enabled);
    set({ enabled, unlocked: true });
  },

  lock: () => set({ unlocked: false }),
  unlock: () => set({ unlocked: true }),
}));

/** Reads the store and hydrates it once, for screens that only display state. */
export function useAppLock() {
  const state = useAppLockStore();

  useEffect(() => {
    if (state.enabled === null) void state.hydrate();
  }, [state]);

  return state;
}

export { promptDeviceUnlock };
