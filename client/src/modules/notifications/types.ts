/** The five bundled reminder voices. Ported from client-old/utils/reminders.ts. */
export type ReminderSoundId = 'voice1' | 'voice2' | 'voice3' | 'voice4' | 'voice5';

export type ReminderSoundOption = {
  id: ReminderSoundId;
  label: string;
  description: string;
  /** Bundled asset name. Must match the `sounds` array in app.json. */
  fileName: string;
  /**
   * Android delivers per-sound notification channels, not per-notification
   * sounds: once a channel exists its sound cannot be changed, so switching
   * voice means switching channel. One channel per voice is the only way the
   * setting can take effect on an install that already fired a reminder.
   */
  channelId: string;
};

export const REMINDER_SOUND_OPTIONS: ReminderSoundOption[] = [
  {
    id: 'voice1',
    label: 'เสียง 1',
    description: 'สั้น นุ่ม เป็นกันเอง',
    fileName: 'bp_voice_1.wav',
    channelId: 'bp-reminders-voice-1',
  },
  {
    id: 'voice2',
    label: 'เสียง 2',
    description: 'สุภาพ ช้า เหมาะกับผู้สูงอายุ',
    fileName: 'bp_voice_2.wav',
    channelId: 'bp-reminders-voice-2',
  },
  {
    id: 'voice3',
    label: 'เสียง 3',
    description: 'ชัดเจน พร้อมบอกให้บันทึกค่า',
    fileName: 'bp_voice_3.wav',
    channelId: 'bp-reminders-voice-3',
  },
  {
    id: 'voice4',
    label: 'เสียง 4',
    description: 'เตือนเบา ๆ ฟังสบาย',
    fileName: 'bp_voice_4.wav',
    channelId: 'bp-reminders-voice-4',
  },
  {
    id: 'voice5',
    label: 'เสียง 5',
    description: 'อบอุ่น ให้กำลังใจ',
    fileName: 'bp_voice_5.wav',
    channelId: 'bp-reminders-voice-5',
  },
];

/**
 * One alarm-style reminder time, local wall-clock. Not a `Date` — this has to
 * survive `JSON.stringify` round-trips through AsyncStorage and repeat every
 * week, so it is deliberately just the two numbers a weekly trigger needs.
 */
export type ReminderTime = {
  /** 0–23. */
  hour: number;
  /** 0–59. */
  minute: number;
};

/** Minutes since midnight — the sort/dedupe key for a `ReminderTime`. */
function reminderTimeOrdinal(time: ReminderTime): number {
  return time.hour * 60 + time.minute;
}

/**
 * Validates, de-duplicates, and sorts a list of reminder times.
 *
 * One function doing all three because they are the same invariant: nothing
 * downstream (the schedule planner, the OS trigger, the settings screen's own
 * list) can tell a malformed entry from a real one, so admitting one here
 * means it resurfaces as a silent double-booking or a crash three layers
 * away. Takes `unknown` because its two callers need that — `storage.ts`
 * feeds it a JSON blob written by a build that may have shipped a different
 * shape, and `reminders.tsx` feeds it the in-memory list plus one new entry
 * from the time picker, which needs the same duplicate check.
 */
export function normalizeReminderTimes(times: unknown): ReminderTime[] {
  if (!Array.isArray(times)) return [];

  const seen = new Map<number, ReminderTime>();
  for (const raw of times) {
    if (!raw || typeof raw !== 'object') continue;
    const { hour, minute } = raw as Record<string, unknown>;
    if (
      typeof hour === 'number' &&
      Number.isInteger(hour) &&
      hour >= 0 &&
      hour <= 23 &&
      typeof minute === 'number' &&
      Number.isInteger(minute) &&
      minute >= 0 &&
      minute <= 59
    ) {
      const time = { hour, minute };
      seen.set(reminderTimeOrdinal(time), time);
    }
  }

  return [...seen.values()].sort((a, b) => reminderTimeOrdinal(a) - reminderTimeOrdinal(b));
}

export type ReminderSettings = {
  enabled: boolean;
  /**
   * Specific times of day to remind at, set individually like alarms —
   * replaces the old interval + hour-window formula. Always sorted and
   * de-duplicated; `normalizeReminderTimes` is what enforces that, both on
   * load and whenever the settings screen adds one.
   */
  reminderTimes: ReminderTime[];
  /** Weekdays to remind on, `0` = Sunday, matching `Date.getDay()`. */
  selectedDays: number[];
  soundId: ReminderSoundId;
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  // Off until the user asks for it. A health app that starts pushing
  // notifications at a patient who never requested them gets muted at the
  // OS level, and a muted app cannot remind anyone of anything.
  enabled: false,
  reminderTimes: [{ hour: 8, minute: 0 }],
  selectedDays: [0, 1, 2, 3, 4, 5, 6],
  soundId: 'voice1',
};

export const DAY_OPTIONS = [
  { label: 'อา', value: 0 },
  { label: 'จ', value: 1 },
  { label: 'อ', value: 2 },
  { label: 'พ', value: 3 },
  { label: 'พฤ', value: 4 },
  { label: 'ศ', value: 5 },
  { label: 'ส', value: 6 },
];

export type ReminderPermissionState =
  | 'granted'
  | 'denied'
  /** Denied and the OS will not show the prompt again — only Settings can fix it. */
  | 'blocked'
  /** Not asked yet. */
  | 'undetermined'
  /** No notification support in this runtime at all (Expo Go on Android). */
  | 'unsupported';

export type ReminderDiagnostics = {
  permission: ReminderPermissionState;
  /** How many OS-level scheduled notifications this app currently holds. */
  scheduledCount: number;
  /** Human-readable, in Thai — shown directly in the UI. */
  reason: string;
};

export function getReminderSoundOption(soundId?: ReminderSoundId): ReminderSoundOption {
  return (
    REMINDER_SOUND_OPTIONS.find((option) => option.id === soundId) ??
    REMINDER_SOUND_OPTIONS[0]
  );
}
