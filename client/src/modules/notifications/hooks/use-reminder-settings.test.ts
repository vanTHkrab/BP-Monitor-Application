/**
 * Reminder settings, and the OS schedule that has to agree with them.
 *
 * Three properties carry the weight here, and none of them is visible in a
 * type:
 *
 *   - **Reconcile runs once per user per app session.** The guard is
 *     module-level rather than a ref because two screens read these settings,
 *     and reconciling *cancels before it re-adds*. A per-instance guard would
 *     therefore mean that opening the settings screen briefly leaves the
 *     patient with no reminders at all, purely to render a subtitle. That is a
 *     health app silently dropping the thing it exists to do, so the
 *     second-mount tests below are the point of this file rather than
 *     completeness.
 *   - **Permission is requested only on the transition into "on".** Android 13
 *     grants one chance at the prompt; spending it at a moment the user cannot
 *     connect to something they did burns it permanently. Asserted as a
 *     negative, because a positive assertion passes just as happily when the
 *     request also fires somewhere it should not.
 *   - **A refused permission is stored as `enabled: false`.** A stored `true`
 *     the OS will not honour makes every later launch retry a schedule that
 *     cannot exist, and shows the user a switch that lies.
 *
 * Mocked at `../services/reminder-service` and `../lib/storage` — the two
 * boundaries the hook imports. It does not touch `expo-notifications`
 * directly: the loader sits behind the service, whose own suite
 * (`reminder-service.test.ts`) owns that boundary. Identity comes from the
 * readings fixture rather than a third hand-rolled copy; see the note in the
 * report about where that file should now live.
 */
jest.mock('@/modules/auth', () =>
  require('../../readings/hooks/__fixtures__/identity').authModuleMock(),
);

const mockLoadReminderSettings = jest.fn();
const mockSaveReminderSettings = jest.fn();
jest.mock('../lib/storage', () => ({
  loadReminderSettings: (...a: unknown[]) => mockLoadReminderSettings(...a),
  saveReminderSettings: (...a: unknown[]) => mockSaveReminderSettings(...a),
}));

const mockApplyReminderSchedule = jest.fn();
const mockGetPermissionState = jest.fn();
const mockGetReminderDiagnostics = jest.fn();
const mockRequestReminderPermission = jest.fn();
const mockSendTestReminder = jest.fn();
jest.mock('../services/reminder-service', () => ({
  applyReminderSchedule: (...a: unknown[]) => mockApplyReminderSchedule(...a),
  getPermissionState: (...a: unknown[]) => mockGetPermissionState(...a),
  getReminderDiagnostics: (...a: unknown[]) => mockGetReminderDiagnostics(...a),
  requestReminderPermission: (...a: unknown[]) => mockRequestReminderPermission(...a),
  sendTestReminder: (...a: unknown[]) => mockSendTestReminder(...a),
}));

import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  actAsSignedOut,
  identity,
  resetIdentity,
  SELF,
} from '../../readings/hooks/__fixtures__/identity';
import type { ReminderPlan } from '../lib/schedule-plan';
import {
  DEFAULT_REMINDER_SETTINGS,
  type ReminderDiagnostics,
  type ReminderSettings,
} from '../types';
import { resetReminderReconciliation, useReminderSettings } from './use-reminder-settings';

const ENABLED_SETTINGS: ReminderSettings = {
  ...DEFAULT_REMINDER_SETTINGS,
  enabled: true,
  intervalHours: 4,
  startHour: 8,
  endHour: 20,
  selectedDays: [1, 2, 3, 4, 5],
  soundId: 'voice2',
};

const PLAN: ReminderPlan = { slots: [], effectiveIntervalHours: 4, thinned: false };

const diagnostics = (overrides: Partial<ReminderDiagnostics> = {}): ReminderDiagnostics => ({
  permission: 'granted',
  scheduledCount: 5,
  reason: 'พร้อมแจ้งเตือน',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` clears recorded calls but not implementations, so a value
  // one test installs would otherwise leak into every test after it.
  mockLoadReminderSettings.mockReset();
  mockSaveReminderSettings.mockReset();
  mockApplyReminderSchedule.mockReset();
  mockGetPermissionState.mockReset();
  mockGetReminderDiagnostics.mockReset();
  mockRequestReminderPermission.mockReset();
  mockSendTestReminder.mockReset();

  mockLoadReminderSettings.mockResolvedValue(DEFAULT_REMINDER_SETTINGS);
  mockSaveReminderSettings.mockResolvedValue(undefined);
  mockApplyReminderSchedule.mockResolvedValue(PLAN);
  mockGetPermissionState.mockResolvedValue('granted');
  mockGetReminderDiagnostics.mockResolvedValue(diagnostics());
  mockRequestReminderPermission.mockResolvedValue('granted');
  mockSendTestReminder.mockResolvedValue(true);

  resetIdentity();
  // The reconcile guard is module state and survives between tests in this
  // file — without this, every test after the first sees "already reconciled".
  resetReminderReconciliation();
});

const mountSettled = async () => {
  const view = await renderHook(() => useReminderSettings());
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
};

describe('hydrating on mount', () => {
  it('loads the signed-in user’s own settings', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);

    const view = await mountSettled();

    // Scoped to the user: a shared blob would hand a caregiver's schedule to
    // the next person who signs in on the same device.
    expect(mockLoadReminderSettings).toHaveBeenCalledWith(SELF.id);
    expect(view.result.current.settings).toEqual(ENABLED_SETTINGS);
  });

  it('starts from the defaults, which are off', async () => {
    const view = await mountSettled();

    // A health app that starts pushing notifications at a patient who never
    // asked gets muted at the OS level, and a muted app reminds nobody.
    expect(view.result.current.settings.enabled).toBe(false);
    expect(view.result.current.plan).toBeNull();
  });

  it('always refreshes diagnostics, even with reminders switched off', async () => {
    const view = await mountSettled();

    // The settings row renders `diagnostics.reason` whether or not reminders
    // are on — "off" still needs an explanation.
    await waitFor(() => expect(view.result.current.diagnostics).toEqual(diagnostics()));
  });

  it('reconciles the OS schedule when reminders are on and permitted', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);

    const view = await mountSettled();

    await waitFor(() => expect(view.result.current.plan).toEqual(PLAN));
    // Re-registered from the *stored* settings, not from the defaults the
    // state was seeded with — a weekly trigger survives a reboot but the blob
    // and the OS queue can still drift.
    expect(mockApplyReminderSchedule).toHaveBeenCalledWith(ENABLED_SETTINGS);
  });

  it('schedules nothing while reminders are off', async () => {
    await mountSettled();

    // The negative half of the reconcile. Registering a schedule for settings
    // that say "off" is how a user who turned reminders off keeps getting them.
    expect(mockGetPermissionState).not.toHaveBeenCalled();
    expect(mockApplyReminderSchedule).not.toHaveBeenCalled();
  });

  it('refuses to schedule when permission was revoked outside the app', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);
    mockGetPermissionState.mockResolvedValue('denied');
    mockGetReminderDiagnostics.mockResolvedValue(
      diagnostics({ permission: 'denied', scheduledCount: 0, reason: 'ปิดการแจ้งเตือนอยู่' }),
    );

    const view = await mountSettled();

    await waitFor(() => expect(view.result.current.diagnostics?.permission).toBe('denied'));
    // No plan and no attempt to build one: a switch that says "on" over a
    // system that will never deliver is worse than an honest "off".
    expect(view.result.current.plan).toBeNull();
    expect(mockApplyReminderSchedule).not.toHaveBeenCalled();
    // The settings screen surfaces this instead.
    expect(view.result.current.diagnostics?.reason).toBe('ปิดการแจ้งเตือนอยู่');
  });

  it('keeps the stored settings visible even when they cannot be honoured', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);
    mockGetPermissionState.mockResolvedValue('blocked');

    const view = await mountSettled();

    // Hydration does not rewrite the blob. The user's choices are still their
    // choices, and the screen needs them to render the form they will fix.
    expect(view.result.current.settings).toEqual(ENABLED_SETTINGS);
    expect(mockSaveReminderSettings).not.toHaveBeenCalled();
  });

  it('files a signed-out session under a guest key rather than crashing', async () => {
    actAsSignedOut();

    await mountSettled();

    expect(mockLoadReminderSettings).toHaveBeenCalledWith(undefined);
  });
});

describe('the once-per-session reconcile guard', () => {
  it('does not re-register the schedule when a second screen mounts', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);

    const first = await mountSettled();
    await waitFor(() => expect(first.result.current.plan).toEqual(PLAN));
    expect(mockApplyReminderSchedule).toHaveBeenCalledTimes(1);

    // The settings row and the screen that edits it both call this hook.
    const second = await mountSettled();
    await waitFor(() => expect(second.result.current.diagnostics).not.toBeNull());

    // Reconciling cancels before it re-adds, so a second registration means a
    // window with no reminders scheduled at all — caused by nothing more than
    // opening a screen to read a subtitle.
    expect(mockApplyReminderSchedule).toHaveBeenCalledTimes(1);
  });

  it('reconciles again for a different user on the same device', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);
    await mountSettled();
    expect(mockApplyReminderSchedule).toHaveBeenCalledTimes(1);

    // Account switch. The previous user's schedule is still registered with
    // the OS and has to be replaced, not inherited.
    identity.userId = 'u2';
    identity.user = { ...SELF, id: 'u2' };
    const second = await mountSettled();

    await waitFor(() => expect(second.result.current.plan).toEqual(PLAN));
    expect(mockApplyReminderSchedule).toHaveBeenCalledTimes(2);
  });

  it('still refreshes diagnostics on a mount that skips the reconcile', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);
    await mountSettled();
    mockGetReminderDiagnostics.mockClear();

    const second = await mountSettled();

    // The guard covers re-registering, not reading. A second screen that
    // never refreshed would render a stale permission state.
    await waitFor(() => expect(mockGetReminderDiagnostics).toHaveBeenCalled());
    expect(second.result.current.diagnostics).toEqual(diagnostics());
  });
});

describe('turning reminders on', () => {
  it('asks for permission and registers the schedule', async () => {
    const view = await mountSettled();

    let permission;
    await act(async () => {
      permission = await view.result.current.update(ENABLED_SETTINGS);
    });

    expect(permission).toBe('granted');
    expect(mockRequestReminderPermission).toHaveBeenCalledTimes(1);
    // Persisted before the schedule is built, and under this user's key.
    expect(mockSaveReminderSettings).toHaveBeenCalledWith(ENABLED_SETTINGS, SELF.id);
    expect(mockApplyReminderSchedule).toHaveBeenCalledWith(ENABLED_SETTINGS);
    expect(view.result.current.plan).toEqual(PLAN);
    expect(view.result.current.settings).toEqual(ENABLED_SETTINGS);
  });

  it('stores a refused permission as off, and schedules nothing', async () => {
    mockRequestReminderPermission.mockResolvedValue('denied');

    const view = await mountSettled();
    let permission;
    await act(async () => {
      permission = await view.result.current.update(ENABLED_SETTINGS);
    });

    // The caller is told what actually happened, so it can route the user to
    // system settings rather than showing a switch that flipped.
    expect(permission).toBe('denied');
    // The whole object, not just `enabled`: the user's interval, window, days
    // and voice are still their choices and must survive the refusal, while a
    // stored `enabled: true` would make every later launch retry a schedule
    // that cannot exist.
    expect(mockSaveReminderSettings).toHaveBeenCalledWith(
      { ...ENABLED_SETTINGS, enabled: false },
      SELF.id,
    );
    expect(view.result.current.settings).toEqual({ ...ENABLED_SETTINGS, enabled: false });
    expect(mockApplyReminderSchedule).not.toHaveBeenCalled();
    expect(view.result.current.plan).toBeNull();
  });

  it('treats an unsupported runtime the same as a refusal', async () => {
    // Expo Go on Android has no notification support at all. Storing "on"
    // there would produce the same permanent retry loop a denial does.
    mockRequestReminderPermission.mockResolvedValue('unsupported');

    const view = await mountSettled();
    let permission;
    await act(async () => {
      permission = await view.result.current.update(ENABLED_SETTINGS);
    });

    expect(permission).toBe('unsupported');
    expect(view.result.current.settings.enabled).toBe(false);
    expect(mockApplyReminderSchedule).not.toHaveBeenCalled();
  });

  it('refreshes diagnostics after a refusal so the screen can explain itself', async () => {
    mockRequestReminderPermission.mockResolvedValue('blocked');
    const view = await mountSettled();
    mockGetReminderDiagnostics.mockResolvedValue(
      diagnostics({ permission: 'blocked', scheduledCount: 0, reason: 'ต้องเปิดในตั้งค่าระบบ' }),
    );

    await act(async () => {
      await view.result.current.update(ENABLED_SETTINGS);
    });

    // The refusal branch returns early — without its own refresh the user
    // sees a stale "พร้อมแจ้งเตือน" beside a switch that just refused to move.
    expect(view.result.current.diagnostics?.reason).toBe('ต้องเปิดในตั้งค่าระบบ');
  });
});

describe('editing settings that are already on', () => {
  it('does not spend Android’s one permission prompt again', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);
    const view = await mountSettled();
    await waitFor(() => expect(view.result.current.settings.enabled).toBe(true));

    await act(async () => {
      await view.result.current.update({ ...ENABLED_SETTINGS, intervalHours: 6 });
    });

    // The negative that matters: asking at a moment the user cannot connect
    // to something they did burns the single prompt Android 13 allows.
    expect(mockRequestReminderPermission).not.toHaveBeenCalled();
    expect(mockApplyReminderSchedule).toHaveBeenCalledWith({
      ...ENABLED_SETTINGS,
      intervalHours: 6,
    });
  });

  it('re-registers the schedule when the voice changes', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);
    const view = await mountSettled();
    await waitFor(() => expect(view.result.current.settings.enabled).toBe(true));
    mockApplyReminderSchedule.mockClear();

    await act(async () => {
      await view.result.current.update({ ...ENABLED_SETTINGS, soundId: 'voice5' });
    });

    // Android delivers per-sound channels and a channel's sound cannot be
    // changed once it exists, so switching voice means re-registering — a
    // settings write alone would leave the old voice playing forever.
    expect(mockApplyReminderSchedule).toHaveBeenCalledWith({
      ...ENABLED_SETTINGS,
      soundId: 'voice5',
    });
  });
});

describe('turning reminders off', () => {
  it('saves and re-applies without asking for permission', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);
    const view = await mountSettled();
    await waitFor(() => expect(view.result.current.settings.enabled).toBe(true));

    const off = { ...ENABLED_SETTINGS, enabled: false };
    let permission;
    await act(async () => {
      permission = await view.result.current.update(off);
    });

    expect(permission).toBe('granted');
    expect(mockRequestReminderPermission).not.toHaveBeenCalled();
    expect(mockSaveReminderSettings).toHaveBeenCalledWith(off, SELF.id);
    // Still applied — this is what cancels the pending OS notifications. A
    // short-circuit here leaves a switched-off app still firing reminders.
    expect(mockApplyReminderSchedule).toHaveBeenCalledWith(off);
  });
});

describe('the saving flag', () => {
  it('is raised for the duration of an update and lowered afterwards', async () => {
    let settle: (value: undefined) => void = () => {};
    mockSaveReminderSettings.mockImplementation(() => new Promise((r) => (settle = r)));

    const view = await mountSettled();
    await act(async () => {
      void view.result.current.update(ENABLED_SETTINGS);
    });

    // The form disables on this; without it a second tap races the first
    // write and can register two schedules.
    expect(view.result.current.isSaving).toBe(true);

    await act(async () => {
      settle(undefined);
    });
    await waitFor(() => expect(view.result.current.isSaving).toBe(false));
  });

  it('is lowered again when the write throws', async () => {
    mockSaveReminderSettings.mockRejectedValue(new Error('storage full'));

    const view = await mountSettled();
    await act(async () => {
      await expect(view.result.current.update(ENABLED_SETTINGS)).rejects.toThrow('storage full');
    });

    // The `finally` is the point: a stuck `isSaving` leaves the settings form
    // permanently disabled with no way back except restarting the app.
    expect(view.result.current.isSaving).toBe(false);
  });
});

describe('the test reminder', () => {
  it('reports whether it fired and refreshes diagnostics either way', async () => {
    mockLoadReminderSettings.mockResolvedValue(ENABLED_SETTINGS);
    const view = await mountSettled();
    mockGetReminderDiagnostics.mockClear();
    mockGetReminderDiagnostics.mockResolvedValue(diagnostics({ scheduledCount: 6 }));

    let ok;
    await act(async () => {
      ok = await view.result.current.sendTest();
    });

    expect(ok).toBe(true);
    // Sent with the *current* settings, so the user hears the voice they just
    // picked rather than the one that was stored when the screen opened.
    expect(mockSendTestReminder).toHaveBeenCalledWith(ENABLED_SETTINGS);
    expect(view.result.current.diagnostics?.scheduledCount).toBe(6);
  });

  it('reports a failure rather than pretending it fired', async () => {
    mockSendTestReminder.mockResolvedValue(false);

    const view = await mountSettled();
    let ok;
    await act(async () => {
      ok = await view.result.current.sendTest();
    });

    expect(ok).toBe(false);
  });

  it('uses the settings just written, not the ones loaded at mount', async () => {
    const view = await mountSettled();
    await act(async () => {
      await view.result.current.update(ENABLED_SETTINGS);
    });

    await act(async () => {
      await view.result.current.sendTest();
    });

    // The callback closes over `settings`; a stale dependency list would test
    // the old voice and convince the user their choice did not take.
    expect(mockSendTestReminder).toHaveBeenCalledWith(ENABLED_SETTINGS);
  });
});

describe('refreshing diagnostics on demand', () => {
  it('replaces what the screen shows', async () => {
    const view = await mountSettled();
    mockGetReminderDiagnostics.mockResolvedValue(
      diagnostics({ scheduledCount: 12, reason: 'ตั้งเวลาไว้ 12 รายการ' }),
    );

    await act(async () => {
      await view.result.current.refreshDiagnostics();
    });

    // Wired to the screen's pull-to-refresh: permission can change while the
    // app is backgrounded, and this is the only way back to the truth.
    expect(view.result.current.diagnostics).toEqual(
      diagnostics({ scheduledCount: 12, reason: 'ตั้งเวลาไว้ 12 รายการ' }),
    );
  });
});
