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

export type ReminderSettings = {
  enabled: boolean;
  /** Hours between reminders within the active window. */
  intervalHours: number;
  /** Local wall-clock hour the window opens, inclusive. */
  startHour: number;
  /** Local wall-clock hour the window closes, inclusive. */
  endHour: number;
  /** Weekdays to remind on, `0` = Sunday, matching `Date.getDay()`. */
  selectedDays: number[];
  soundId: ReminderSoundId;
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  // Off until the user asks for it. A health app that starts pushing
  // notifications at a patient who never requested them gets muted at the
  // OS level, and a muted app cannot remind anyone of anything.
  enabled: false,
  intervalHours: 4,
  startHour: 7,
  endHour: 19,
  selectedDays: [0, 1, 2, 3, 4, 5, 6],
  soundId: 'voice1',
};

export const INTERVAL_OPTIONS = [2, 3, 4, 6, 8, 12] as const;

/** 05:00–22:00. Outside that a reminder is more likely to wake someone than help. */
export const HOUR_OPTIONS = Array.from({ length: 18 }, (_, index) => index + 5);

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
