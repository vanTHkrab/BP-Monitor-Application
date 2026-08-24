/**
 * The signals the gate needs, read from where each actually lives.
 *
 * Deliberately not one flag: the role is server state and must survive a
 * reinstall, while the app settings are device-local and *should* be asked
 * again on a fresh install. Collapsing them would get one of the two wrong.
 */
import { useSession } from '@/modules/auth';
import { usePreferencesStore } from '@/stores';

export function useOnboardingState() {
  const { user, isAuthenticated } = useSession();
  const setupCompleted = usePreferencesStore((state) => state.setupCompleted);
  const hydrated = usePreferencesStore((state) => state.hydrated);

  return {
    // `null` while `me` is in flight — the gate has to wait rather than
    // treat "not loaded" as "not selected".
    roleSelected: !isAuthenticated ? null : user ? Boolean(user.roleSelectedAt) : null,
    // Same shape as `roleSelected`, and read from the same `me`: `null` until
    // it resolves, so the gate waits rather than bouncing a signed-in user to
    // the phone screen for a frame.
    phoneComplete: !isAuthenticated ? null : user ? Boolean(user.phone) : null,
    appConfigured: setupCompleted,
    preferencesHydrated: hydrated,
  };
}
