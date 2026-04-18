import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

export interface ReminderSettings {
  enabled: boolean;
  intervalHours: number;
  startHour: number;
  endHour: number;
  selectedDays: number[];
}

export interface ReminderDiagnostics {
  supported: boolean;
  permissionGranted: boolean;
  canAskAgain: boolean;
  scheduledCount: number;
  reason: string;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  intervalHours: 4,
  startHour: 7,
  endHour: 19,
  selectedDays: [0, 1, 2, 3, 4, 5, 6],
};

const REMINDER_KIND = "bp_flex_reminder";
const FOLLOW_UP_KIND = "bp_flex_follow_up";
const REMINDER_CATEGORY_ID = "bp_reminder_actions";
const HORIZON_DAYS = 14;

export const REMINDER_DONE_ACTION_ID = "bp_reminder_done";
export const REMINDER_SNOOZE_5_ACTION_ID = "bp_reminder_snooze_5";
export const REMINDER_BUSY_ACTION_ID = "bp_reminder_busy_30";

const isExpoGo = Constants.appOwnership === "expo";

const getNotificationsModule = async () => {
  if (isExpoGo) return null;
  return import("expo-notifications");
};

const getReminderSettingsStorageKey = (userId?: string) =>
  `bp.reminder_settings.${userId ?? "guest"}`;

const isReminderNotification = (data: Record<string, unknown> | undefined) =>
  data?.kind === REMINDER_KIND || data?.kind === FOLLOW_UP_KIND;

const isSameUserReminder = (
  data: Record<string, unknown> | undefined,
  userId?: string,
) => {
  if (!userId) return false;
  return data?.reminderUserId === userId;
};

export const configureReminderActions = async () => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY_ID, [
    {
      identifier: REMINDER_DONE_ACTION_ID,
      buttonTitle: "วัดแล้ว",
      options: { opensAppToForeground: true },
    },
    {
      identifier: REMINDER_SNOOZE_5_ACTION_ID,
      buttonTitle: "อีก 5 นาที",
      options: { opensAppToForeground: false },
    },
    {
      identifier: REMINDER_BUSY_ACTION_ID,
      buttonTitle: "ยังไม่ว่าง",
      options: { opensAppToForeground: false },
    },
  ]);
};

export const loadReminderSettings = async (userId?: string) => {
  try {
    const raw = await AsyncStorage.getItem(getReminderSettingsStorageKey(userId));
    if (!raw) return DEFAULT_REMINDER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ReminderSettings>;
    return {
      enabled: Boolean(parsed.enabled),
      intervalHours:
        Number(parsed.intervalHours) || DEFAULT_REMINDER_SETTINGS.intervalHours,
      startHour:
        typeof parsed.startHour === "number"
          ? parsed.startHour
          : DEFAULT_REMINDER_SETTINGS.startHour,
      endHour:
        typeof parsed.endHour === "number"
          ? parsed.endHour
          : DEFAULT_REMINDER_SETTINGS.endHour,
      selectedDays:
        Array.isArray(parsed.selectedDays) && parsed.selectedDays.length > 0
          ? parsed.selectedDays.filter(
              (day) => Number.isInteger(day) && day >= 0 && day <= 6,
            )
          : DEFAULT_REMINDER_SETTINGS.selectedDays,
    };
  } catch {
    return DEFAULT_REMINDER_SETTINGS;
  }
};

export const saveReminderSettings = async (
  settings: ReminderSettings,
  userId?: string,
) => {
  await AsyncStorage.setItem(
    getReminderSettingsStorageKey(userId),
    JSON.stringify(settings),
  );
};

export const buildReminderHours = (settings: ReminderSettings) => {
  const hours: number[] = [];
  const step = Math.max(1, settings.intervalHours);
  for (let hour = settings.startHour; hour <= settings.endHour; hour += step) {
    hours.push(hour);
  }
  return hours;
};

export const getReminderPreview = (settings: ReminderSettings) =>
  buildReminderHours(settings).map(
    (hour) => `${String(hour).padStart(2, "0")}:00`,
  );

export const requestReminderPermissions = async () => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;

  const current = await Notifications.getPermissionsAsync();
  if (
    current.granted ||
    current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return true;
  }
  const requested = await Notifications.requestPermissionsAsync();
  return (
    requested.granted ||
    requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
};

export const getReminderDiagnostics = async (
  userId?: string,
): Promise<ReminderDiagnostics> => {
  if (!userId) {
    return {
      supported: false,
      permissionGranted: false,
      canAskAgain: false,
      scheduledCount: 0,
      reason: "กรุณาเข้าสู่ระบบก่อนใช้งานการแจ้งเตือน",
    };
  }

  const Notifications = await getNotificationsModule();
  if (!Notifications) {
    return {
      supported: false,
      permissionGranted: false,
      canAskAgain: false,
      scheduledCount: 0,
      reason: "Expo Go ยังไม่รองรับการแจ้งเตือนชุดนี้ กรุณาใช้ development build",
    };
  }

  const permissions = await Notifications.getPermissionsAsync();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const ownScheduled = scheduled.filter((item) =>
    isSameUserReminder(
      item.content.data as Record<string, unknown> | undefined,
      userId,
    ),
  );
  const permissionGranted =
    permissions.granted ||
    permissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;

  let reason = "พร้อมใช้งาน";
  if (!permissionGranted) {
    reason = "ยังไม่ได้รับสิทธิ์แจ้งเตือนจากระบบ";
  } else if (ownScheduled.length === 0) {
    reason = "ยังไม่มีรายการแจ้งเตือนที่ถูกตั้งไว้";
  }

  return {
    supported: true,
    permissionGranted,
    canAskAgain: permissions.canAskAgain ?? false,
    scheduledCount: ownScheduled.length,
    reason,
  };
};

const clearExistingReminderNotifications = async (userId?: string) => {
  if (!userId) return;
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;
  const all = await Notifications.getAllScheduledNotificationsAsync();
  const ownIds = all
    .filter((item) =>
      isReminderNotification(item.content.data as Record<string, unknown>) &&
      isSameUserReminder(item.content.data as Record<string, unknown>, userId),
    )
    .map((item) => item.identifier);

  await Promise.all(
    ownIds.map((identifier) =>
      Notifications.cancelScheduledNotificationAsync(identifier),
    ),
  );
};

const scheduleNotificationAt = async ({
  when,
  title,
  body,
  kind,
  occurrenceKey,
  userId,
}: {
  when: Date;
  title: string;
  body: string;
  kind: typeof REMINDER_KIND | typeof FOLLOW_UP_KIND;
  occurrenceKey: string;
  userId: string;
}) => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return "";

  return Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      categoryIdentifier: REMINDER_CATEGORY_ID,
      data: {
        kind,
        reminderUserId: userId,
        occurrenceKey,
      },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
      channelId: "bp-reminders",
    },
  });
};

const getOccurrenceKey = (date: Date) => date.toISOString();

const cancelPendingOccurrenceNotifications = async (
  occurrenceKey: string,
  userId: string,
) => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const matching = scheduled.filter((item) => {
    const data = item.content.data as Record<string, unknown> | undefined;
    return (
      data?.occurrenceKey === occurrenceKey &&
      data?.reminderUserId === userId &&
      isReminderNotification(data)
    );
  });

  await Promise.all(
    matching.map((item) =>
      Notifications.cancelScheduledNotificationAsync(item.identifier),
    ),
  );
};

export const scheduleSnoozedReminder = async ({
  delayMinutes,
  userId,
  sourceOccurrenceKey,
}: {
  delayMinutes: number;
  userId: string;
  sourceOccurrenceKey: string;
}) => {
  const when = new Date(Date.now() + delayMinutes * 60_000);
  const occurrenceKey = `${sourceOccurrenceKey}:snooze:${delayMinutes}:${when.toISOString()}`;
  await scheduleNotificationAt({
    when,
    title: "เตือนอีกครั้งให้วัดความดัน",
    body:
      delayMinutes <= 5
        ? "ครบเวลาแล้ว ลองวัดความดันตอนนี้ได้เลย"
        : "เมื่อสะดวกแล้ว ลองวัดความดันและบันทึกค่าไว้ในแอป",
    kind: FOLLOW_UP_KIND,
    occurrenceKey,
    userId,
  });
};

export const handleReminderNotificationResponse = async (
  response: any,
) => {
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | undefined;
  const userId =
    typeof data?.reminderUserId === "string" ? data.reminderUserId : undefined;
  const occurrenceKey =
    typeof data?.occurrenceKey === "string" ? data.occurrenceKey : undefined;

  if (!userId || !occurrenceKey || !isReminderNotification(data)) return;

  await cancelPendingOccurrenceNotifications(occurrenceKey, userId);

  if (response.actionIdentifier === REMINDER_SNOOZE_5_ACTION_ID) {
    await scheduleSnoozedReminder({
      delayMinutes: 5,
      userId,
      sourceOccurrenceKey: occurrenceKey,
    });
    return;
  }

  if (response.actionIdentifier === REMINDER_BUSY_ACTION_ID) {
    await scheduleSnoozedReminder({
      delayMinutes: 30,
      userId,
      sourceOccurrenceKey: occurrenceKey,
    });
  }
};

export const subscribeToReminderResponses = async (
  onResponse: (response: any) => void,
) => {
  const Notifications = await getNotificationsModule();
  if (!Notifications) return null;
  return Notifications.addNotificationResponseReceivedListener(onResponse);
};

export const scheduleFlexibleReminders = async (
  settings: ReminderSettings,
  userId?: string,
) => {
  if (!userId) return;
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  await clearExistingReminderNotifications(userId);

  if (!settings.enabled || settings.selectedDays.length === 0) return;

  await configureReminderActions();

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("bp-reminders", {
      name: "BP Reminders",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#3498DB",
    });
  }

  const hours = buildReminderHours(settings);
  const now = new Date();
  const jobs: Promise<string>[] = [];

  for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
    const currentDay = new Date(now);
    currentDay.setHours(0, 0, 0, 0);
    currentDay.setDate(now.getDate() + offset);

    const weekday = currentDay.getDay();
    if (!settings.selectedDays.includes(weekday)) continue;

    for (const hour of hours) {
      const when = new Date(currentDay);
      when.setHours(hour, 0, 0, 0);
      if (when <= now) continue;

      const occurrenceKey = getOccurrenceKey(when);
      jobs.push(
        scheduleNotificationAt({
          when,
          title: "ได้เวลาวัดความดันแล้ว",
          body: "ถ้ายังไม่พร้อม คุณกดเตือนอีก 5 นาทีหรือเลือกว่ายังไม่ว่างได้",
          kind: REMINDER_KIND,
          occurrenceKey,
          userId,
        }),
      );

      const followUpAt = new Date(when.getTime() + 15 * 60_000);
      jobs.push(
        scheduleNotificationAt({
          when: followUpAt,
          title: "ยังไม่ได้วัดความดันใช่ไหม",
          body: "หากยังไม่ได้วัด ระบบเตือนให้อีกครั้งแล้ว เมื่อพร้อมค่อยกดเข้ามาบันทึกได้เลย",
          kind: FOLLOW_UP_KIND,
          occurrenceKey,
          userId,
        }),
      );
    }
  }

  await Promise.all(jobs);
};

export const scheduleTestReminder = async (userId?: string) => {
  if (!userId) return false;
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;

  const granted = await requestReminderPermissions();
  if (!granted) return false;

  const when = new Date(Date.now() + 10_000);
  await scheduleNotificationAt({
    when,
    title: "ทดสอบการแจ้งเตือน",
    body: "ถ้าคุณเห็นข้อความนี้ แปลว่าระบบแจ้งเตือนทำงานแล้ว",
    kind: FOLLOW_UP_KIND,
    occurrenceKey: `test:${when.toISOString()}`,
    userId,
  });
  return true;
};
