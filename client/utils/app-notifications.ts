import type { BloodPressureReading } from "@/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface InAppNotificationItem {
  id: string;
  type: "reading" | "reminder" | "system";
  title: string;
  body: string;
  createdAt: Date;
  readAt?: Date;
}

type NotificationReadMap = Record<string, string>;

const getNotificationReadStorageKey = (userId?: string) =>
  `bp.notifications.read.${userId ?? "guest"}`;

const getReadingNotificationTitle = (reading: BloodPressureReading) => {
  switch (reading.status) {
    case "critical":
      return "ความดันสูงมาก ควรเฝ้าระวัง";
    case "high":
      return "ความดันค่อนข้างสูง";
    case "elevated":
      return "ค่าความดันเริ่มสูง";
    case "low":
      return "ค่าความดันค่อนข้างต่ำ";
    case "normal":
    default:
      return "บันทึกผลการวัดสำเร็จ";
  }
};

const getReadingNotificationBody = (reading: BloodPressureReading) =>
  `ผลวัด ${reading.systolic}/${reading.diastolic} mmHg ชีพจร ${reading.pulse} bpm`;

const buildReadingNotifications = (readings: BloodPressureReading[]) =>
  [...readings]
    .sort(
      (a, b) =>
        new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
    )
    .slice(0, 20)
    .map((reading) => ({
      id: `reading-${reading.id}`,
      type: "reading" as const,
      title: getReadingNotificationTitle(reading),
      body: getReadingNotificationBody(reading),
      createdAt: new Date(reading.measuredAt),
    }));

const loadReadMap = async (userId?: string): Promise<NotificationReadMap> => {
  try {
    const raw = await AsyncStorage.getItem(getNotificationReadStorageKey(userId));
    if (!raw) return {};
    return JSON.parse(raw) as NotificationReadMap;
  } catch {
    return {};
  }
};

const saveReadMap = async (map: NotificationReadMap, userId?: string) => {
  await AsyncStorage.setItem(
    getNotificationReadStorageKey(userId),
    JSON.stringify(map),
  );
};

export const getInAppNotifications = async ({
  userId,
  readings,
}: {
  userId?: string;
  readings: BloodPressureReading[];
}): Promise<InAppNotificationItem[]> => {
  const readMap = await loadReadMap(userId);
  return buildReadingNotifications(readings).map((item) => ({
    ...item,
    readAt: readMap[item.id] ? new Date(readMap[item.id]) : undefined,
  }));
};

export const markNotificationAsRead = async ({
  userId,
  notificationId,
}: {
  userId?: string;
  notificationId: string;
}) => {
  const map = await loadReadMap(userId);
  map[notificationId] = new Date().toISOString();
  await saveReadMap(map, userId);
};

export const markAllNotificationsAsRead = async ({
  userId,
  notificationIds,
}: {
  userId?: string;
  notificationIds: string[];
}) => {
  const map = await loadReadMap(userId);
  const now = new Date().toISOString();
  for (const id of notificationIds) {
    map[id] = now;
  }
  await saveReadMap(map, userId);
};
