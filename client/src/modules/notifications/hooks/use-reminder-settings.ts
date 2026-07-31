/**
 * Reminder settings, and the OS schedule that has to agree with them.
 *
 * The reconcile-on-open is not housekeeping — it is what keeps the two in
 * step. Weekly triggers survive a reboot, but the settings blob and the OS
 * queue can still drift: permission revoked from system settings, the app
 * reinstalled over its own data, a schedule written by an older build. Opening
 * the app is the one moment we can check cheaply and repair silently, so it is
 * done exactly once per mount and never on a timer.
 */
import { useCallback, useEffect, useState } from 'react';

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

  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [plan, setPlan] = useState<ReminderPlan | null>(null);
  const [diagnostics, setDiagnostics] = useState<ReminderDiagnostics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const refreshDiagnostics = useCallback(async () => {
    setDiagnostics(await getReminderDiagnostics());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const stored = await loadReminderSettings(userId);
      if (cancelled) return;

      setSettings(stored);
      setIsLoading(false);

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
  }, [userId, refreshDiagnostics]);

  /**
   * Persists, then re-registers. Permission is requested only on the
   * transition into "on" — asking at any other moment spends Android 13's one
   * chance at a time the user cannot connect it to something they did.
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
            setSettings(refused);
            await saveReminderSettings(refused, userId);
            await refreshDiagnostics();
            return permission;
          }
        }

        setSettings(next);
        await saveReminderSettings(next, userId);
        setPlan(await applyReminderSchedule(next));
        await refreshDiagnostics();
        return permission;
      } finally {
        setIsSaving(false);
      }
    },
    [settings.enabled, userId, refreshDiagnostics],
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
    isLoading,
    isSaving,
    update,
    sendTest,
    refreshDiagnostics,
  };
}
