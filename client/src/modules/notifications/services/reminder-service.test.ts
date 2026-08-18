/**
 * The reminder I/O layer.
 *
 * Not a GraphQL wrapper — nothing here touches the gateway. It is the seam
 * between `lib/schedule-plan.ts` (pure, already tested) and expo-notifications,
 * and every defect it can have is silent: a weekday off by one shifts every
 * reminder a day, a cancel that matches too widely deletes another app's
 * notifications, a cancel that matches too narrowly leaves last week's
 * schedule stacked on top of this week's, and a permission request fired at
 * the wrong moment burns Android 13's single shot forever.
 *
 * It schedules OS notifications, not JS timers, so there is no fake-timer
 * hazard for the next suite — `scheduleNotificationAsync` is a mock.
 */
const mockLoadNotifications = jest.fn();
jest.mock('./notifications-module', () => ({
  loadNotifications: () => mockLoadNotifications(),
}));

import { Platform } from 'react-native';

import { DEFAULT_REMINDER_SETTINGS, getReminderSoundOption, type ReminderSettings } from '../types';
import {
  applyReminderSchedule,
  cancelPendingFollowUps,
  FOLLOW_UP_KIND,
  getPermissionState,
  getReminderDiagnostics,
  REMINDER_KIND,
  requestReminderPermission,
  scheduleFollowUp,
  sendTestReminder,
  snoozeReminder,
} from './reminder-service';

type ScheduledStub = {
  identifier: string;
  content: { data?: Record<string, unknown> };
};

/** Enough of expo-notifications for this file, with the knobs each test needs. */
const notificationsModule = (over: {
  permission?: { granted: boolean; canAskAgain: boolean };
  onRequest?: { granted: boolean; canAskAgain: boolean };
  scheduled?: ScheduledStub[];
} = {}) => {
  const permission = over.permission ?? { granted: true, canAskAgain: true };
  return {
    getPermissionsAsync: jest.fn().mockResolvedValue(permission),
    requestPermissionsAsync: jest.fn().mockResolvedValue(over.onRequest ?? permission),
    getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(over.scheduled ?? []),
    cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
    scheduleNotificationAsync: jest.fn().mockResolvedValue('new-id'),
    setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
    setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
    AndroidImportance: { HIGH: 4 },
    SchedulableTriggerInputTypes: { WEEKLY: 'weekly', TIME_INTERVAL: 'timeInterval' },
  };
};

type NotificationsStub = ReturnType<typeof notificationsModule>;

const use = (stub: NotificationsStub | null): NotificationsStub | null => {
  mockLoadNotifications.mockResolvedValue(stub);
  return stub;
};

/** A schedule small enough to enumerate: two days, one reminder each. */
const settings: ReminderSettings = {
  ...DEFAULT_REMINDER_SETTINGS,
  enabled: true,
  reminderTimes: [{ hour: 8, minute: 15 }],
  selectedDays: [0, 6],
  soundId: 'voice3',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('requestReminderPermission', () => {
  it('reports the runtime as unsupported rather than throwing where push does not exist', async () => {
    use(null);

    await expect(requestReminderPermission()).resolves.toBe('unsupported');
  });

  it('does not re-prompt someone who already granted', async () => {
    const stub = use(notificationsModule({ permission: { granted: true, canAskAgain: true } }))!;

    await expect(requestReminderPermission()).resolves.toBe('granted');
    expect(stub.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  /*
   * Android 13's `POST_NOTIFICATIONS` gives one shot. Asking again once the OS
   * has stopped showing the dialog resolves instantly as a denial and burns
   * nothing — but it also makes the UI say "denied" when the honest answer is
   * "only Settings can fix this", which is a different sentence to the user.
   */
  it('says blocked, without asking again, once the OS will not show the prompt', async () => {
    const stub = use(notificationsModule({ permission: { granted: false, canAskAgain: false } }))!;

    await expect(requestReminderPermission()).resolves.toBe('blocked');
    expect(stub.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks when there is still a shot, and reports the grant', async () => {
    const stub = use(
      notificationsModule({
        permission: { granted: false, canAskAgain: true },
        onRequest: { granted: true, canAskAgain: true },
      }),
    )!;

    await expect(requestReminderPermission()).resolves.toBe('granted');
    expect(stub.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a denial that can be retried from one that cannot', async () => {
    use(
      notificationsModule({
        permission: { granted: false, canAskAgain: true },
        onRequest: { granted: false, canAskAgain: true },
      }),
    );
    await expect(requestReminderPermission()).resolves.toBe('denied');

    use(
      notificationsModule({
        permission: { granted: false, canAskAgain: true },
        onRequest: { granted: false, canAskAgain: false },
      }),
    );
    // "Never ask again" ticked inside the dialog: retryable a moment ago, not
    // any more.
    await expect(requestReminderPermission()).resolves.toBe('blocked');
  });
});

describe('getPermissionState', () => {
  it('never prompts, whatever the answer', async () => {
    const stub = use(notificationsModule({ permission: { granted: false, canAskAgain: true } }))!;

    await expect(getPermissionState()).resolves.toBe('undetermined');
    expect(stub.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports granted and blocked from the current state alone', async () => {
    use(notificationsModule({ permission: { granted: true, canAskAgain: false } }));
    await expect(getPermissionState()).resolves.toBe('granted');

    use(notificationsModule({ permission: { granted: false, canAskAgain: false } }));
    await expect(getPermissionState()).resolves.toBe('blocked');
  });

  it('reports unsupported where the module never loads', async () => {
    use(null);

    await expect(getPermissionState()).resolves.toBe('unsupported');
  });
});

describe('applyReminderSchedule', () => {
  it('still returns the plan where notifications are unavailable', async () => {
    use(null);

    const plan = await applyReminderSchedule(settings);

    // The caller shows the user what was planned; an empty answer here would
    // read as "you asked for nothing".
    expect(plan.slots).toHaveLength(2);
  });

  it('books one weekly trigger per slot', async () => {
    const stub = use(notificationsModule())!;

    await applyReminderSchedule(settings);

    expect(stub.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  /*
   * expo-notifications counts weekdays from 1 = Sunday; everything else in
   * this module counts from 0. Off by one here shifts every reminder a day,
   * which reads as "the app is broken" rather than as a bug in one line.
   */
  it('converts the weekday to expo’s 1-based numbering', async () => {
    const stub = use(notificationsModule())!;

    await applyReminderSchedule(settings);

    const weekdays = stub.scheduleNotificationAsync.mock.calls.map(
      (call) => (call[0] as { trigger: { weekday: number } }).trigger.weekday,
    );
    // Sunday (0) and Saturday (6) become 1 and 7.
    expect(weekdays.sort()).toEqual([1, 7]);
  });

  it('books the exact hour and minute the user chose', async () => {
    const stub = use(notificationsModule())!;

    await applyReminderSchedule(settings);

    const trigger = (stub.scheduleNotificationAsync.mock.calls[0][0] as {
      trigger: Record<string, unknown>;
    }).trigger;
    expect(trigger).toMatchObject({ type: 'weekly', hour: 8, minute: 15 });
  });

  it('stamps our own kind on every reminder so a later cancel can find it', async () => {
    const stub = use(notificationsModule())!;

    await applyReminderSchedule(settings);

    for (const call of stub.scheduleNotificationAsync.mock.calls) {
      const content = (call[0] as { content: { data: { kind: string } } }).content;
      expect(content.data.kind).toBe(REMINDER_KIND);
    }
  });

  it('attaches the action buttons and the chosen voice', async () => {
    const stub = use(notificationsModule())!;

    await applyReminderSchedule(settings);

    expect(stub.setNotificationCategoryAsync).toHaveBeenCalledTimes(1);
    const content = (stub.scheduleNotificationAsync.mock.calls[0][0] as {
      content: { sound: string; categoryIdentifier: string };
    }).content;
    expect(content.sound).toBe(getReminderSoundOption('voice3').fileName);
    expect(content.categoryIdentifier).toBe('bp_reminder_actions');
  });

  /*
   * The cancel is matched on the `kind` we stamped, not on "everything
   * pending". This app is not the only thing on the phone with scheduled
   * notifications, and `cancelAllScheduledNotificationsAsync` would take the
   * others with it.
   */
  it('cancels only this app’s reminders, leaving anything else pending alone', async () => {
    const stub = use(
      notificationsModule({
        scheduled: [
          { identifier: 'ours-1', content: { data: { kind: REMINDER_KIND } } },
          { identifier: 'ours-2', content: { data: { kind: FOLLOW_UP_KIND } } },
          { identifier: 'someone-else', content: { data: { kind: 'calendar_event' } } },
          { identifier: 'no-data', content: {} },
        ],
      }),
    )!;

    await applyReminderSchedule(settings);

    const cancelled = stub.cancelScheduledNotificationAsync.mock.calls.map((call) => call[0]);
    expect(cancelled.sort()).toEqual(['ours-1', 'ours-2']);
  });

  it('clears the old schedule even when the new one is empty', async () => {
    const stub = use(
      notificationsModule({
        scheduled: [{ identifier: 'ours-1', content: { data: { kind: REMINDER_KIND } } }],
      }),
    )!;

    // Turning reminders off has to remove them, not just stop adding.
    await applyReminderSchedule({ ...settings, enabled: false });

    expect(stub.cancelScheduledNotificationAsync).toHaveBeenCalledWith('ours-1');
    expect(stub.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not create an Android channel on iOS', async () => {
    const stub = use(notificationsModule())!;

    await applyReminderSchedule(settings);

    expect(stub.setNotificationChannelAsync).not.toHaveBeenCalled();
    const trigger = (stub.scheduleNotificationAsync.mock.calls[0][0] as {
      trigger: { channelId?: string };
    }).trigger;
    expect(trigger.channelId).toBeUndefined();
  });

  describe('on Android', () => {
    let platform: ReturnType<typeof jest.replaceProperty>;

    beforeEach(() => {
      platform = jest.replaceProperty(Platform, 'OS', 'android');
    });

    afterEach(() => {
      platform.restore();
    });

    /*
     * A channel's sound is fixed at creation and changing it later is ignored,
     * so one channel per voice is the only arrangement in which the sound
     * setting does anything on a device that already fired a reminder.
     */
    it('creates the channel belonging to the chosen voice, carrying its sound', async () => {
      const stub = use(notificationsModule())!;
      const sound = getReminderSoundOption('voice3');

      await applyReminderSchedule(settings);

      expect(stub.setNotificationChannelAsync).toHaveBeenCalledWith(
        sound.channelId,
        expect.objectContaining({ sound: sound.fileName, importance: 4 }),
      );
    });

    it('routes the trigger through that channel', async () => {
      const stub = use(notificationsModule())!;

      await applyReminderSchedule(settings);

      const trigger = (stub.scheduleNotificationAsync.mock.calls[0][0] as {
        trigger: { channelId?: string };
      }).trigger;
      expect(trigger.channelId).toBe(getReminderSoundOption('voice3').channelId);
    });

    it('switches channel when the user picks a different voice', async () => {
      const stub = use(notificationsModule())!;

      await applyReminderSchedule({ ...settings, soundId: 'voice5' });

      expect(stub.setNotificationChannelAsync.mock.calls[0][0]).toBe(
        getReminderSoundOption('voice5').channelId,
      );
    });
  });
});

describe('scheduleFollowUp', () => {
  it('books the nudge fifteen minutes out, once', async () => {
    const stub = use(notificationsModule())!;

    await scheduleFollowUp();

    const request = stub.scheduleNotificationAsync.mock.calls[0][0] as {
      content: { data: { kind: string } };
      trigger: Record<string, unknown>;
    };
    expect(request.trigger).toEqual({
      type: 'timeInterval',
      seconds: 15 * 60,
      repeats: false,
    });
    // Its own kind: `cancelPendingFollowUps` must be able to drop this without
    // touching the weekly schedule.
    expect(request.content.data.kind).toBe(FOLLOW_UP_KIND);
  });

  it('does nothing where notifications are unavailable', async () => {
    use(null);

    await expect(scheduleFollowUp()).resolves.toBeUndefined();
  });
});

describe('snoozeReminder', () => {
  it('re-books the reminder five minutes out under the reminder kind', async () => {
    const stub = use(notificationsModule())!;

    await snoozeReminder();

    const request = stub.scheduleNotificationAsync.mock.calls[0][0] as {
      content: { data: { kind: string } };
      trigger: Record<string, unknown>;
    };
    expect(request.trigger).toEqual({
      type: 'timeInterval',
      seconds: 5 * 60,
      repeats: false,
    });
    expect(request.content.data.kind).toBe(REMINDER_KIND);
  });
});

describe('cancelPendingFollowUps', () => {
  /*
   * The negative is the whole point: this runs when the user records a
   * reading, and taking the weekly reminders with it would silently turn the
   * feature off for someone who was using it correctly.
   */
  it('drops only the follow-ups, leaving the weekly schedule standing', async () => {
    const stub = use(
      notificationsModule({
        scheduled: [
          { identifier: 'follow-1', content: { data: { kind: FOLLOW_UP_KIND } } },
          { identifier: 'weekly-1', content: { data: { kind: REMINDER_KIND } } },
          { identifier: 'other', content: { data: { kind: 'calendar_event' } } },
        ],
      }),
    )!;

    await cancelPendingFollowUps();

    expect(stub.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(stub.cancelScheduledNotificationAsync).toHaveBeenCalledWith('follow-1');
  });

  it('does nothing where notifications are unavailable', async () => {
    use(null);

    await expect(cancelPendingFollowUps()).resolves.toBeUndefined();
  });
});

describe('sendTestReminder', () => {
  it('fires in ten seconds when permission is already granted', async () => {
    const stub = use(notificationsModule())!;

    await expect(sendTestReminder(settings)).resolves.toBe(true);
    const request = stub.scheduleNotificationAsync.mock.calls[0][0] as {
      trigger: { seconds: number };
    };
    expect(request.trigger.seconds).toBe(10);
  });

  it('reports failure and schedules nothing when permission is refused', async () => {
    const stub = use(
      notificationsModule({
        permission: { granted: false, canAskAgain: true },
        onRequest: { granted: false, canAskAgain: true },
      }),
    )!;

    await expect(sendTestReminder(settings)).resolves.toBe(false);
    // A "test" that silently books an undeliverable notification would tell
    // the user the system works when it does not.
    expect(stub.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('reports failure where notifications are unavailable', async () => {
    use(null);

    await expect(sendTestReminder(settings)).resolves.toBe(false);
  });
});

describe('getReminderDiagnostics', () => {
  it('explains the Expo Go limitation rather than blaming permissions', async () => {
    use(null);

    const diagnostics = await getReminderDiagnostics();

    expect(diagnostics.permission).toBe('unsupported');
    expect(diagnostics.scheduledCount).toBe(0);
    expect(diagnostics.reason).toContain('Expo Go');
  });

  it('counts only this app’s reminders, not everything the OS holds', async () => {
    use(
      notificationsModule({
        scheduled: [
          { identifier: 'a', content: { data: { kind: REMINDER_KIND } } },
          { identifier: 'b', content: { data: { kind: FOLLOW_UP_KIND } } },
          { identifier: 'c', content: { data: { kind: 'calendar_event' } } },
        ],
      }),
    );

    const diagnostics = await getReminderDiagnostics();

    expect(diagnostics.scheduledCount).toBe(2);
    expect(diagnostics.reason).toContain('2');
  });

  it('says nothing is scheduled yet when permission is fine but the list is empty', async () => {
    use(notificationsModule({ scheduled: [] }));

    const diagnostics = await getReminderDiagnostics();

    expect(diagnostics.permission).toBe('granted');
    expect(diagnostics.reason).toBe('ยังไม่ได้ตั้งเวลาเตือน');
  });

  it('points at the system settings when the OS is blocking', async () => {
    use(notificationsModule({ permission: { granted: false, canAskAgain: false } }));

    const diagnostics = await getReminderDiagnostics();

    expect(diagnostics.permission).toBe('blocked');
    expect(diagnostics.reason).toContain('ตั้งค่าของเครื่อง');
  });

  it('asks for permission in the copy when it was simply never granted', async () => {
    use(notificationsModule({ permission: { granted: false, canAskAgain: true } }));

    const diagnostics = await getReminderDiagnostics();

    expect(diagnostics.permission).toBe('undetermined');
    expect(diagnostics.reason).toBe('ยังไม่ได้อนุญาตให้แอปแจ้งเตือน');
  });
});
