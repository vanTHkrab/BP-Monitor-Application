/**
 * Reminder settings, and the OS schedule that has to agree with them.
 *
 * The reconcile-on-open is not housekeeping — it is what keeps the two in
 * step. Weekly triggers survive a reboot, but the settings blob and the OS
 * queue can still drift: permission revoked from system settings, the app
 * reinstalled over its own data, a schedule written by an older build. Opening
 * the app is the one moment we can check cheaply and repair silently, so it is
 * done exactly once per mount and never on a timer.
 *
 * **The settings themselves live in TanStack Query, not a plain `useState`.**
 * `app/settings.tsx` (a subtitle) and `app/reminders.tsx` (the edit screen)
 * both call this hook, and a `useState` gives each call site its own private
 * copy with no channel between them. Saving on the edit screen would then
 * leave the settings row showing whatever it read on its own original mount
 * — stale, and specifically wrong the moment Expo Router's stack keeps the
 * settings screen mounted underneath while `reminders.tsx` is pushed on top.
 * `modules/auth/hooks/use-login-sessions.ts` already solved this shape of
 * problem for server data with `useQuery` + `invalidateQueries`; the same
 * cache is reused here for local data because the actual defect — two
 * independent in-memory copies of one value — is identical, and there is no
 * other shared-state primitive in this app for something that is neither
 * server state nor one of the two device-preference stores (`stores/auth`,
 * `stores/preferences`) reserved for genuinely device-local state. This is
 * still device-local data with no network origin, so `update()` writes the
 * known-good value straight into the cache with `setQueryData` rather than
 * `invalidateQueries` + refetch: the write to `AsyncStorage` just completed
 * with this exact value, so re-reading it back off storage would be a round
 * trip that could only tell us what we already know.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/modules/auth';
import { loadReminderSettings, saveReminderSettings } from '../lib/storage';
import type { ReminderPlan } from '../lib/schedule-plan';
import {
  applyReminderSchedule,
  getPermissionState,
  getReminderDiagnostics,
  requestReminderPermission,
  sendTestReminder,
} from '../services/reminder-service';
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderDiagnostics,
  type ReminderPermissionState,
  type ReminderSettings,
} from '../types';

/** The cache key every consumer of this hook shares. Exported for tests. */
export function reminderSettingsQueryKey(userId?: string): readonly [string, string] {
  return ['reminder-settings', userId ?? 'guest'] as const;
}

/**
 * Which user's schedule has already been reconciled this app session.
 *
 * Module-level, not a ref: two screens read these settings — the settings row
 * that shows the schedule, and the screen that edits it — and a per-instance
 * guard would let each one re-register the whole schedule on mount. Since
 * reconciling cancels before it re-adds, that means opening settings would
 * briefly leave the user with no reminders at all, purely to render a
 * subtitle.
 */
let reconciledUserId: string | null = null;

/** Test seam. Nothing in the app should need this. */
export function resetReminderReconciliation(): void {
  reconciledUserId = null;
}

export function useReminderSettings() {
  const { user } = useSession();
  const userId = user?.id;
  const queryClient = useQueryClient();

  // The reactive half: every call site subscribes to the same cache entry,
  // so a write from any one of them is visible to all of them on their next
  // render. `staleTime: Infinity` because this hook is the only writer of
  // this entry — `update()` below pushes the saved value straight in with
  // `setQueryData` — so there is nothing for react-query to refetch behind
  // its own back.
  const settingsQuery = useQuery<ReminderSettings>({
    queryKey: reminderSettingsQueryKey(userId),
    queryFn: () => loadReminderSettings(userId),
    staleTime: Infinity,
  });
  const settings = settingsQuery.data ?? DEFAULT_REMINDER_SETTINGS;

  const [plan, setPlan] = useState<ReminderPlan | null>(null);
  const [diagnostics, setDiagnostics] = useState<ReminderDiagnostics | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnostics(await getReminderDiagnostics());
  }, []);

  // The imperative half: resolving *this* mount's settings for the
  // reconcile check. Deliberately not driven by `settingsQuery.data` — that
  // reference also changes every time `update()` below calls `setQueryData`,
  // and this effect must NOT re-run on every save the way the mount-once
  // hydrate never did before. `ensureQueryData` returns the same cached
  // value `settingsQuery` above is subscribed to (a second screen mounting
  // after the first has already loaded gets it with no extra I/O), so this
  // and the rendered `settings` can never disagree about what was loaded.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const stored = await queryClient.ensureQueryData({
        queryKey: reminderSettingsQueryKey(userId),
        queryFn: () => loadReminderSettings(userId),
        staleTime: Infinity,
      });
      if (cancelled) return;

      // Once per user per app session — see `reconciledUserId` above.
      if (stored.enabled && reconciledUserId !== (userId ?? 'guest')) {
        reconciledUserId = userId ?? 'guest';

        const permission = await getPermissionState();
        if (permission === 'granted') {
          const applied = await applyReminderSchedule(stored);
          if (!cancelled) setPlan(applied);
        } else if (!cancelled) {
          // Permission was revoked outside the app. Reflect that rather than
          // leaving a switch that says "on" over a system that will never
          // deliver — the settings screen surfaces `diagnostics.reason`.
          setPlan(null);
        }
      }

      if (!cancelled) await refreshDiagnostics();
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [userId, queryClient, refreshDiagnostics]);

  /**
   * Persists, then re-registers. Permission is requested only on the
   * transition into "on" — asking at any other moment spends Android 13's one
   * chance at a time the user cannot connect it to something they did.
   *
   * Writes the cache with `setQueryData` rather than `invalidateQueries`:
   * `next` (or its refused-permission variant) is already the exact value
   * `saveReminderSettings` just wrote to disk, so every other mounted screen
   * reading this hook should see it the instant this call resolves — not
   * after a second round trip through AsyncStorage to confirm what is
   * already known.
   */
  const update = useCallback(
    async (next: ReminderSettings): Promise<ReminderPermissionState> => {
      setIsSaving(true);
      try {
        let permission: ReminderPermissionState = 'granted';

        if (next.enabled && !settings.enabled) {
          permission = await requestReminderPermission();
          if (permission !== 'granted') {
            // Store the refusal as "off". A stored `enabled: true` that the OS
            // will not honour makes every later launch retry a schedule that
            // cannot exist, and shows the user a switch that lies.
            const refused = { ...next, enabled: false };
            await saveReminderSettings(refused, userId);
            queryClient.setQueryData(reminderSettingsQueryKey(userId), refused);
            await refreshDiagnostics();
            return permission;
          }
        }

        await saveReminderSettings(next, userId);
        queryClient.setQueryData(reminderSettingsQueryKey(userId), next);
        setPlan(await applyReminderSchedule(next));
        await refreshDiagnostics();
        return permission;
      } finally {
        setIsSaving(false);
      }
    },
    [settings.enabled, userId, queryClient, refreshDiagnostics],
  );

  const sendTest = useCallback(async () => {
    const ok = await sendTestReminder(settings);
    await refreshDiagnostics();
    return ok;
  }, [settings, refreshDiagnostics]);

  return {
    settings,
    plan,
    diagnostics,
    isLoading: settingsQuery.isLoading,
    isSaving,
    update,
    sendTest,
    refreshDiagnostics,
  };
}
