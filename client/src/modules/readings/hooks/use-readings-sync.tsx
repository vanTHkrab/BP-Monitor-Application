/**
 * The one place readings are pushed and pulled, for the whole app.
 *
 * Before this existed, every screen wired its own triggers: `useSyncReadings`
 * registered an `AppState` **and** a `NetInfo` listener per call site, and it
 * was called from the home tab, the history tab, and `use-create-reading` —
 * so a running app held three or four copies of each, and every return to
 * the foreground fired that many `NetInfo.fetch()` calls into a drain that
 * the mutex then collapsed back into one. Worse, the *pull* had no trigger at
 * all: `fetchReadings` was reachable only from a `RefreshControl`, so a fresh
 * install showed an empty history until the user thought to drag the screen
 * down.
 *
 * Both halves belong to the app, not to a screen. A screen is a *view* of the
 * mirror — it should ask for a refresh when the user explicitly pulls, and
 * otherwise render whatever SQLite currently holds.
 *
 * ## The triggers, and why each one is here
 *
 * | Trigger | Forced? | Why |
 * | --- | --- | --- |
 * | Session resolves, or the subject changes | yes | The rows on screen belong to somebody else, or to nobody yet. A cooldown here would show the previous patient's history. |
 * | App returns to the foreground | no | The common case is a user who backgrounded the app for eight seconds. Throttled. |
 * | Offline → online | yes | The queue has something to say and the mirror is by definition stale. |
 * | Pull-to-refresh | yes | The user asked. Never make them ask twice. |
 *
 * A timer is deliberately absent: polling drains a queue that is almost
 * always empty on a device where every wakeup costs battery.
 *
 * ## Push before pull
 *
 * Always in that order. A reading that drains during this pass comes back in
 * the same round-trip instead of one refresh later — the alternative is a
 * user watching their own measurement sit at "รอซิงค์" through a refresh they
 * personally triggered.
 */
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import { db } from '@/database';
import { useSession } from '@/modules/auth';
import { useActivePatient } from '@/modules/caregivers';

import { clearMirror } from '../repository/mirror';
import { useFetchReadings } from './use-fetch-readings';
import { useSyncReadings } from './use-sync-readings';

/**
 * How long a successful pull suppresses the next unforced one.
 *
 * Tuned against the foreground trigger, which is the only unforced caller:
 * flipping between this app and a messaging app should not re-fetch the whole
 * history each time, but a user who left it for a minute should not be
 * looking at data from before they left either.
 */
const PULL_COOLDOWN_MS = 30_000;

export type RefreshOptions = {
  /** Skip the cooldown. Anything the user or a state change asked for. */
  force?: boolean;
};

export type ReadingsSyncValue = {
  /** Push the queue, then pull the mirror. Never throws. */
  refresh: (options?: RefreshOptions) => Promise<void>;
  /** True while a pull is in flight — what a `RefreshControl` binds to. */
  isRefreshing: boolean;
  /** The last pull's failure, or null. Offline lands here and is not fatal. */
  error: string | null;
};

const ReadingsSyncContext = createContext<ReadingsSyncValue | null>(null);

export function ReadingsSyncProvider({ children }: { children: ReactNode }) {
  const { userId, isAuthenticated } = useSession();
  const { viewingPatientId } = useActivePatient();

  // Whose readings this app is currently showing. A caregiver inside a
  // patient's history is looking at the patient's rows, so that is what has
  // to be pulled — the tabs read the same value.
  const subjectId = viewingPatientId ?? userId ?? null;

  const { sync } = useSyncReadings();
  const { fetchReadings, isFetching, error } = useFetchReadings({ patientId: viewingPatientId });

  const lastPullRef = useRef<{ subjectId: string | null; at: number }>({
    subjectId: null,
    at: 0,
  });
  // Coalesces overlapping triggers the way `runSync` does for the drain: the
  // foreground and offline→online edges routinely fire within a frame of each
  // other, and two pulls would race each other into the same tables.
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(
    async ({ force = false }: RefreshOptions = {}): Promise<void> => {
      if (!isAuthenticated || !subjectId) return;
      if (inFlightRef.current) return inFlightRef.current;

      const last = lastPullRef.current;
      const isCoolingDown =
        last.subjectId === subjectId && Date.now() - last.at < PULL_COOLDOWN_MS;
      if (!force && isCoolingDown) return;

      const run = (async () => {
        await sync();
        const pulled = await fetchReadings();
        // Only a *successful* pull starts the cooldown. Recording a failed one
        // would leave a user who was offline for a moment staring at stale
        // history for the next 30 seconds with no way to hurry it.
        if (pulled) lastPullRef.current = { subjectId, at: Date.now() };
      })().finally(() => {
        inFlightRef.current = null;
      });

      inFlightRef.current = run;
      return run;
    },
    [fetchReadings, isAuthenticated, subjectId, sync],
  );

  /**
   * The account this device last held rows for, so leaving it can be noticed.
   *
   * `clearMirror` existed with no caller: sign-out wiped the token and the
   * query cache and left SQLite untouched, so the next person to sign in on
   * the phone could see the previous account's history until their first
   * successful fetch pruned it. Watching the id here rather than calling the
   * wipe from `useLogout` covers *both* ways a session ends — the button, and
   * the 401 fan-out — and avoids `modules/auth` importing `modules/readings`,
   * which already imports it back.
   *
   * **The queue is deliberately left alone.** `clearQueue` is the obvious
   * companion call and it is the wrong one: a queued reading exists nowhere
   * else in the world, and someone who signs out on a train would be deleting
   * their own measurement to tidy up a cache. It stays scoped to its owner by
   * `userId` — no other account can read it or drain it — and it syncs when
   * they come back. Privacy here costs a re-fetch; the alternative costs a
   * medical record.
   */
  const heldUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previous = heldUserIdRef.current;
    heldUserIdRef.current = userId ?? null;

    // Only a *departure* clears. The first sign-in of a launch moves null →
    // id, and wiping there would delete the offline history this whole file
    // exists to keep visible.
    if (!previous || previous === userId) return;

    void clearMirror(db, previous).catch(() => {});
  }, [userId]);

  /**
   * Session-resolved and subject-changed, in one effect.
   *
   * `refresh` is rebuilt exactly when `isAuthenticated`, `userId`, or
   * `viewingPatientId` changes — nothing else it closes over is unstable — so
   * depending on the callback *is* depending on those three. Listing them
   * again here would be a second copy of that fact to keep in sync.
   */
  useEffect(() => {
    void refresh({ force: true });
  }, [refresh]);

  // Foreground edge. `AppState` fires on every transition; this is the one
  // that means "the user came back".
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // Offline → online, rising edge only. NetInfo also emits on reachability
  // changes while already connected, and refreshing on each of those is work
  // with nothing to do.
  useEffect(() => {
    let wasConnected: boolean | null = null;

    return NetInfo.addEventListener((state) => {
      const isConnected = state.isConnected === true;
      if (isConnected && wasConnected === false) void refresh({ force: true });
      wasConnected = isConnected;
    });
  }, [refresh]);

  const value = useMemo<ReadingsSyncValue>(
    () => ({ refresh, isRefreshing: isFetching, error }),
    [error, isFetching, refresh],
  );

  return <ReadingsSyncContext.Provider value={value}>{children}</ReadingsSyncContext.Provider>;
}

/**
 * The screen-facing handle. Throws without a provider rather than degrading
 * to a no-op: a screen whose pull-to-refresh silently does nothing is the
 * exact failure this file was written to remove.
 */
export function useReadingsSync(): ReadingsSyncValue {
  const value = useContext(ReadingsSyncContext);
  if (!value) {
    throw new Error('useReadingsSync must be used inside <ReadingsSyncProvider>');
  }
  return value;
}
