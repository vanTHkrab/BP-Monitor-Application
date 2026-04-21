import { GradientBackground } from "@/components/gradient-background";
import { Colors } from "@/constants/colors";
import { useAppStore } from "@/store/useAppStore";
import { FontSizePreference } from "@/types";
import {
  createExportFileWithRetry,
  ExportDataType,
  ExportFormat,
} from "@/utils/export-data";
import { getFontClass } from "@/utils/font-scale";
import {
  DEFAULT_REMINDER_SETTINGS,
  getReminderDiagnostics,
  getReminderPreview,
  loadReminderSettings,
  type ReminderDiagnostics,
  ReminderSettings,
  requestReminderPermissions,
  saveReminderSettings,
  scheduleTestReminder,
  scheduleFlexibleReminders,
} from "@/utils/reminders";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const DAY_OPTIONS = [
  { label: "อา", value: 0 },
  { label: "จ", value: 1 },
  { label: "อ", value: 2 },
  { label: "พ", value: 3 },
  { label: "พฤ", value: 4 },
  { label: "ศ", value: 5 },
  { label: "ส", value: 6 },
];

const FONT_OPTIONS: Array<{ label: string; value: FontSizePreference }> = [
  { label: "เล็กมาก", value: "xsmall" },
  { label: "เล็ก", value: "small" },
  { label: "มาตรฐาน", value: "medium" },
  { label: "ใหญ่", value: "large" },
  { label: "ใหญ่มาก", value: "xlarge" },
];

const INTERVAL_OPTIONS = [2, 3, 4, 6, 8, 12];
const HOUR_OPTIONS = Array.from({ length: 18 }, (_, index) => index + 5);

export default function SettingsScreen() {
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoBackup, setAutoBackup] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [showReminderModal, setShowReminderModal] = useState(false);
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(
    DEFAULT_REMINDER_SETTINGS,
  );
  const [reminderDiagnostics, setReminderDiagnostics] =
    useState<ReminderDiagnostics | null>(null);

  const themePreference = useAppStore((s) => s.themePreference);
  const setThemePreference = useAppStore((s) => s.setThemePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const setFontSizePreference = useAppStore((s) => s.setFontSizePreference);
  const readings = useAppStore((s) => s.readings);
  const posts = useAppStore((s) => s.posts);
  const user = useAppStore((s) => s.user);
  const deleteAllMyData = useAppStore((s) => s.deleteAllMyData);

  const isDark = themePreference === "dark";
  const headerIconColor = isDark ? "#E2E8F0" : Colors.text.primary;
  const maxExportAttempts = 3;

  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: "text-[15px]",
    small: "text-base",
    medium: "text-lg",
    large: "text-xl",
    xlarge: "text-2xl",
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    xsmall: "text-[13px]",
    small: "text-sm",
    medium: "text-base",
    large: "text-lg",
    xlarge: "text-xl",
  });
  const captionClassName = getFontClass(fontSizePreference, {
    xsmall: "text-[11px]",
    small: "text-xs",
    medium: "text-sm",
    large: "text-base",
    xlarge: "text-lg",
  });

  type ExportRangeKey = "7days" | "30days" | "3months" | "1year" | "all";

  const exportRangeOptions: Array<{ key: ExportRangeKey; label: string }> = [
    { key: "7days", label: "7 วัน" },
    { key: "30days", label: "30 วัน" },
    { key: "3months", label: "3 เดือน" },
    { key: "1year", label: "1 ปี" },
    { key: "all", label: "ทั้งหมด" },
  ];

  useEffect(() => {
    const hydrateReminders = async () => {
      const stored = await loadReminderSettings(user?.id);
      const diagnostics = await getReminderDiagnostics(user?.id);
      setReminderSettings(stored);
      setNotificationsEnabled(stored.enabled);
      setReminderDiagnostics(diagnostics);
    };

    void hydrateReminders();
  }, [user?.id]);

  const reminderPreview = useMemo(
    () => getReminderPreview(reminderSettings),
    [reminderSettings],
  );

  const persistReminderSettings = async (next: ReminderSettings) => {
    setReminderSettings(next);
    await saveReminderSettings(next, user?.id);
    if (!next.enabled) {
      await scheduleFlexibleReminders(next, user?.id);
      setReminderDiagnostics(await getReminderDiagnostics(user?.id));
      return true;
    }

    const granted = await requestReminderPermissions();
    if (!granted) {
      Alert.alert(
        "ยังไม่ได้รับสิทธิ์แจ้งเตือน",
        "กรุณาอนุญาตการแจ้งเตือนในเครื่องก่อนใช้งานการเตือนวัดความดัน",
      );
      return false;
    }

    await scheduleFlexibleReminders(next, user?.id);
    setReminderDiagnostics(await getReminderDiagnostics(user?.id));
    return true;
  };

  const updateReminderSettings = async (
    patch: Partial<ReminderSettings>,
    options?: { skipPermissionCheck?: boolean },
  ) => {
    const next = { ...reminderSettings, ...patch };

    if (next.startHour > next.endHour) {
      Alert.alert("เวลาไม่ถูกต้อง", "เวลาเริ่มต้นต้องไม่มากกว่าเวลาสิ้นสุด");
      return;
    }

    if (next.selectedDays.length === 0) {
      Alert.alert("กรุณาเลือกวัน", "ควรเลือกอย่างน้อย 1 วันสำหรับการแจ้งเตือน");
      return;
    }

    if (options?.skipPermissionCheck) {
      setReminderSettings(next);
      await saveReminderSettings(next, user?.id);
      return;
    }

    const ok = await persistReminderSettings(next);
    if (!ok && patch.enabled) {
      setNotificationsEnabled(false);
      setReminderSettings((current) => ({ ...current, enabled: false }));
      await saveReminderSettings({ ...next, enabled: false }, user?.id);
    }
  };

  const toggleReminderDay = async (day: number) => {
    const nextDays = reminderSettings.selectedDays.includes(day)
      ? reminderSettings.selectedDays.filter((item) => item !== day)
      : [...reminderSettings.selectedDays, day].sort((a, b) => a - b);

    await updateReminderSettings({ selectedDays: nextDays });
  };

  const handleReminderToggle = async (enabled: boolean) => {
    if (enabled) {
      setShowReminderModal(true);
    }
    setNotificationsEnabled(enabled);
    const ok = await persistReminderSettings({
      ...reminderSettings,
      enabled,
    });

    if (!ok && enabled) {
      setNotificationsEnabled(false);
      setReminderSettings((current) => ({ ...current, enabled: false }));
    }
  };

  const filterReadingsByRange = (rangeKey: ExportRangeKey) => {
    if (rangeKey === "all") return readings;

    const now = new Date();
    const cutoffDate = new Date();

    switch (rangeKey) {
      case "7days":
        cutoffDate.setDate(now.getDate() - 7);
        break;
      case "30days":
        cutoffDate.setDate(now.getDate() - 30);
        break;
      case "3months":
        cutoffDate.setMonth(now.getMonth() - 3);
        break;
      case "1year":
        cutoffDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        break;
    }

    return readings.filter((r) => new Date(r.measuredAt) >= cutoffDate);
  };

  const handleExport = async (
    dataType: ExportDataType,
    format: ExportFormat,
    rangeKey: ExportRangeKey,
  ) => {
    if (isExporting) {
      Alert.alert("กำลังส่งออก", "กรุณารอสักครู่");
      return;
    }

    if (Platform.OS === "web") {
      Alert.alert("ไม่รองรับ", "การส่งออกไฟล์ยังไม่รองรับบนเวอร์ชันเว็บ");
      return;
    }

    setIsExporting(true);
    try {
      const readingsForExport =
        dataType === "readings" ? filterReadingsByRange(rangeKey) : [];
      const fileUri = await createExportFileWithRetry(
        {
          dataType,
          format,
          readings: readingsForExport,
          posts,
          userName: user
            ? `${user.firstname} ${user.lastname}`.trim()
            : undefined,
        },
        maxExportAttempts,
      );

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert("ไม่รองรับ", "อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์");
        return;
      }

      await Sharing.shareAsync(fileUri);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ไม่สามารถส่งออกข้อมูลได้";
      Alert.alert("เกิดข้อผิดพลาด", message);
    } finally {
      setIsExporting(false);
    }
  };

  const selectExportFormat = (
    dataType: ExportDataType,
    rangeKey: ExportRangeKey,
  ) => {
    Alert.alert("เลือก Format", "กรุณาเลือกประเภทไฟล์ที่ต้องการ", [
      {
        text: "PDF",
        onPress: () => void handleExport(dataType, "pdf", rangeKey),
      },
      {
        text: "CSV",
        onPress: () => void handleExport(dataType, "csv", rangeKey),
      },
      { text: "ยกเลิก", style: "cancel" },
    ]);
  };

  const selectExportRange = (dataType: ExportDataType) => {
    if (dataType !== "readings") {
      selectExportFormat(dataType, "all");
      return;
    }

    Alert.alert("เลือกช่วงเวลา", "กรุณาเลือกช่วงเวลาที่ต้องการส่งออก", [
      ...exportRangeOptions.map((option) => ({
        text: option.label,
        onPress: () => selectExportFormat("readings", option.key),
      })),
      { text: "ยกเลิก", style: "cancel" },
    ]);
  };

  const startExportFlow = () => {
    if (isExporting) {
      Alert.alert("กำลังส่งออก", "กรุณารอสักครู่");
      return;
    }

    Alert.alert("เลือกข้อมูลที่ต้องการส่งออก", "กรุณาเลือกประเภทข้อมูล", [
      { text: "ค่าความดัน", onPress: () => selectExportRange("readings") },
      { text: "โพสต์ชุมชน", onPress: () => selectExportRange("posts") },
      { text: "ยกเลิก", style: "cancel" },
    ]);
  };

  const confirmDeleteAllData = () => {
    Alert.alert(
      "ลบข้อมูลทั้งหมด",
      "ต้องการลบข้อมูลการวัดและโพสต์ของบัญชีนี้ทั้งหมดใช่หรือไม่? การกระทำนี้ย้อนกลับไม่ได้",
      [
        { text: "ยกเลิก", style: "cancel" },
        {
          text: "ลบทั้งหมด",
          style: "destructive",
          onPress: async () => {
            const ok = await deleteAllMyData();
            if (!ok) {
              Alert.alert("ไม่สำเร็จ", "ไม่สามารถลบข้อมูลทั้งหมดได้");
              return;
            }
            Alert.alert("สำเร็จ", "ลบข้อมูลทั้งหมดเรียบร้อยแล้ว");
          },
        },
      ],
    );
  };

  const reminderSummaryText = !notificationsEnabled
    ? "ปิดการแจ้งเตือนอยู่"
    : `ทุก ${reminderSettings.intervalHours} ชม. ระหว่าง ${String(
        reminderSettings.startHour,
      ).padStart(2, "0")}:00 - ${String(reminderSettings.endHour).padStart(
        2,
        "0",
      )}:00`;

  const refreshReminderDiagnostics = async () => {
    setReminderDiagnostics(await getReminderDiagnostics(user?.id));
  };

  const handleTestReminder = async () => {
    const ok = await scheduleTestReminder(user?.id);
    await refreshReminderDiagnostics();
    if (!ok) {
      Alert.alert(
        "ทดสอบไม่สำเร็จ",
        "ระบบยังไม่พร้อมสำหรับการแจ้งเตือน อาจยังไม่ได้รับสิทธิ์หรือกำลังรันใน Expo Go",
      );
      return;
    }
    Alert.alert("ตั้งทดสอบแล้ว", "อีกประมาณ 10 วินาทีควรมีการแจ้งเตือนเด้งขึ้นมา");
  };

  const SettingItem = ({
    icon,
    title,
    subtitle,
    value,
    onValueChange,
    showToggle = true,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    subtitle?: string;
    value?: boolean;
    onValueChange?: (value: boolean) => void;
    showToggle?: boolean;
  }) => (
    <View className="flex-row items-center bg-white dark:bg-slate-900 p-4 rounded-xl mb-3 border border-sky-200 dark:border-slate-700">
      <View className="w-10 h-10 bg-sky-100 dark:bg-slate-800 rounded-full items-center justify-center mr-3">
        <Ionicons name={icon} size={22} color={Colors.primary.blue} />
      </View>
      <View className="flex-1">
        <Text className={titleClassName + " text-gray-800 dark:text-slate-100 font-medium"}>
          {title}
        </Text>
        {subtitle && (
          <Text className={captionClassName + " text-gray-500 dark:text-slate-300"}>
            {subtitle}
          </Text>
        )}
      </View>
      {showToggle && onValueChange && (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: "#D1D5DB", true: Colors.primary.skyBlue }}
          thumbColor={value ? Colors.primary.blue : "#f4f3f4"}
        />
      )}
    </View>
  );

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Ionicons name="arrow-back" size={28} color={headerIconColor} />
          </TouchableOpacity>
          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 flex-1 text-center"}>
            ตั้งค่าแอปพลิเคชั่น
          </Text>
          <View className="w-7" />
        </View>

        <View className="px-4">
          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3"}>
            การแสดงผล
          </Text>

          <SettingItem
            icon="moon-outline"
            title="โหมดมืด"
            subtitle="เปลี่ยนเป็นธีมมืด"
            value={themePreference === "dark"}
            onValueChange={(value) =>
              void setThemePreference(value ? "dark" : "light")
            }
          />

          <View className="bg-white dark:bg-slate-900 p-4 rounded-xl mb-3 border border-sky-200 dark:border-slate-700">
            <View className="flex-row items-center mb-3">
              <View className="w-10 h-10 bg-sky-100 dark:bg-slate-800 rounded-full items-center justify-center mr-3">
                <Ionicons
                  name="text-outline"
                  size={22}
                  color={Colors.primary.blue}
                />
              </View>
              <View className="flex-1">
                <Text className={titleClassName + " text-gray-800 dark:text-slate-100 font-medium"}>
                  ขนาดตัวหนังสือ
                </Text>
                <Text className={captionClassName + " text-gray-500 dark:text-slate-300"}>
                  ปรับจากหน้านี้แล้วให้หน้าหลักของแอปเปลี่ยนตาม
                </Text>
              </View>
            </View>

            <View className="flex-row flex-wrap">
              {FONT_OPTIONS.map((option, index) => {
                const active = option.value === fontSizePreference;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => void setFontSizePreference(option.value)}
                    className={
                      "rounded-2xl py-3 items-center border px-3 mb-2 " +
                      (active
                        ? "bg-sky-500 border-sky-500"
                        : isDark
                          ? "bg-[#0F172A] border-[#334155]"
                          : "bg-[#F8FAFC] border-[#CBD5E1]") +
                      (index < FONT_OPTIONS.length - 1 ? " mr-2" : "")
                    }
                    style={{ minWidth: "30%" }}
                  >
                    <Text
                      className={
                        bodyClassName +
                        " font-semibold " +
                        (active ? "text-white" : isDark ? "text-slate-100" : "text-[#2C3E50]")
                      }
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3 mt-4"}>
            การแจ้งเตือน
          </Text>

          <SettingItem
            icon="notifications-outline"
            title="เปิดการแจ้งเตือน"
            subtitle="อนุญาตให้แอปส่งการแจ้งเตือนสุขภาพ"
            value={notificationsEnabled}
            onValueChange={(value) => void handleReminderToggle(value)}
          />

          <TouchableOpacity
            className="bg-white dark:bg-slate-900 p-4 rounded-xl mb-3 border border-sky-200 dark:border-slate-700"
            onPress={() => setShowReminderModal(true)}
            activeOpacity={0.9}
          >
            <View className="flex-row items-center">
              <View className="w-10 h-10 bg-sky-100 dark:bg-slate-800 rounded-full items-center justify-center mr-3">
                <Ionicons
                  name="time-outline"
                  size={22}
                  color={Colors.primary.blue}
                />
              </View>
              <View className="flex-1">
                <Text className={titleClassName + " text-gray-800 dark:text-slate-100 font-medium"}>
                  ตั้งค่าแจ้งเตือน
                </Text>
                <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1"}>
                  {reminderSummaryText}
                </Text>
                {notificationsEnabled ? (
                  <Text className={captionClassName + " text-sky-600 dark:text-sky-300 mt-1"}>
                    หากไม่ตอบ ระบบจะเตือนซ้ำอีกครั้ง และผู้ใช้กดเลื่อน 5 นาทีหรือยังไม่ว่างได้
                  </Text>
                ) : null}
              </View>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={Colors.text.secondary}
              />
            </View>
          </TouchableOpacity>

          <View className="bg-white dark:bg-slate-900 p-4 rounded-xl mb-3 border border-sky-200 dark:border-slate-700">
            <Text className={titleClassName + " text-gray-800 dark:text-slate-100 font-medium"}>
              สถานะการแจ้งเตือน
            </Text>
            <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1"}>
              {reminderDiagnostics?.reason ?? "กำลังตรวจสอบสถานะ..."}
            </Text>
            <View className="flex-row flex-wrap mt-3">
              <View className="rounded-full px-3 py-1 bg-sky-100 dark:bg-slate-800 mr-2 mb-2">
                <Text className={captionClassName + " text-sky-700 dark:text-sky-300 font-semibold"}>
                  รองรับ: {reminderDiagnostics?.supported ? "ใช่" : "ไม่"}
                </Text>
              </View>
              <View className="rounded-full px-3 py-1 bg-emerald-100 dark:bg-slate-800 mr-2 mb-2">
                <Text className={captionClassName + " text-emerald-700 dark:text-emerald-300 font-semibold"}>
                  สิทธิ์: {reminderDiagnostics?.permissionGranted ? "อนุญาตแล้ว" : "ยังไม่อนุญาต"}
                </Text>
              </View>
              <View className="rounded-full px-3 py-1 bg-amber-100 dark:bg-slate-800 mr-2 mb-2">
                <Text className={captionClassName + " text-amber-700 dark:text-amber-300 font-semibold"}>
                  รายการเตือน: {reminderDiagnostics?.scheduledCount ?? 0}
                </Text>
              </View>
            </View>

            <View className="flex-row mt-3">
              <TouchableOpacity
                onPress={() => void refreshReminderDiagnostics()}
                className="flex-1 rounded-2xl bg-[#EBF5FB] dark:bg-[#0F172A] py-3 items-center mr-3"
              >
                <Text className={bodyClassName + " font-semibold text-[#2563EB] dark:text-sky-300"}>
                  ตรวจสอบอีกครั้ง
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void handleTestReminder()}
                className="flex-1 rounded-2xl bg-sky-500 py-3 items-center"
              >
                <Text className={bodyClassName + " font-semibold text-white"}>
                  ทดสอบ 10 วิ
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3 mt-4"}>
            ข้อมูล
          </Text>

          <SettingItem
            icon="cloud-upload-outline"
            title="สำรองข้อมูลอัตโนมัติ"
            subtitle="สำรองข้อมูลไปยังคลาวด์"
            value={autoBackup}
            onValueChange={setAutoBackup}
          />

          <TouchableOpacity
            className="flex-row items-center bg-white dark:bg-slate-900 p-4 rounded-xl mb-3 border border-sky-200 dark:border-slate-700"
            onPress={startExportFlow}
          >
            <View className="w-10 h-10 bg-sky-100 dark:bg-slate-800 rounded-full items-center justify-center mr-3">
              <Ionicons
                name="download-outline"
                size={22}
                color={Colors.primary.blue}
              />
            </View>
            <View className="flex-1">
              <Text className={titleClassName + " text-gray-800 dark:text-slate-100 font-medium"}>
                ส่งออกข้อมูล
              </Text>
              <Text className={captionClassName + " text-gray-500 dark:text-slate-300"}>
                ดาวน์โหลดข้อมูลทั้งหมด
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={Colors.text.secondary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            className="flex-row items-center bg-red-50 dark:bg-red-950/40 p-4 rounded-xl mb-3 border border-red-200 dark:border-red-900"
            onPress={confirmDeleteAllData}
          >
            <View className="w-10 h-10 bg-red-100 dark:bg-red-900/50 rounded-full items-center justify-center mr-3">
              <Ionicons
                name="trash-outline"
                size={22}
                color={Colors.status.high}
              />
            </View>
            <View className="flex-1">
              <Text className={titleClassName + " text-red-600 dark:text-red-300 font-medium"}>
                ลบข้อมูลทั้งหมด
              </Text>
              <Text className={captionClassName + " text-red-400 dark:text-red-200/80"}>
                ลบข้อมูลการวัดทั้งหมด
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={Colors.status.high}
            />
          </TouchableOpacity>
        </View>

        <View className="h-8" />
      </ScrollView>

      <Modal
        visible={showReminderModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowReminderModal(false)}
      >
        <View className="flex-1 bg-black/40 justify-center px-4">
          <View className="bg-white dark:bg-slate-900 rounded-3xl p-5 max-h-[85%]">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-1 pr-3">
                <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100"}>
                  ตั้งค่าแจ้งเตือน
                </Text>
                <Text className={captionClassName + " text-gray-500 dark:text-slate-300 mt-1"}>
                  คุณเป็นคนกำหนดวัน ช่วงเวลา และความถี่เองทั้งหมด
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowReminderModal(false)}>
                <Ionicons name="close" size={26} color={headerIconColor} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View className="rounded-2xl bg-sky-50 dark:bg-slate-800/70 p-4 mb-4">
                <Text className={bodyClassName + " font-semibold text-[#2C3E50] dark:text-slate-100"}>
                  การตอบสนองหลังแจ้งเตือน
                </Text>
                <Text className={captionClassName + " text-gray-600 dark:text-slate-300 mt-1 leading-6"}>
                  ถ้าผู้ใช้ไม่วัด ระบบจะเตือนซ้ำอีกครั้งอัตโนมัติ และในแจ้งเตือนจะมีปุ่ม `วัดแล้ว`, `อีก 5 นาที`, `ยังไม่ว่าง`
                </Text>
              </View>

              <Text className={bodyClassName + " font-semibold text-gray-700 dark:text-slate-200 mb-2"}>
                ความถี่ในการเตือน
              </Text>
              <View className="flex-row flex-wrap mb-4">
                {INTERVAL_OPTIONS.map((interval) => {
                  const active = reminderSettings.intervalHours === interval;
                  return (
                    <TouchableOpacity
                      key={interval}
                      onPress={() =>
                        void updateReminderSettings({ intervalHours: interval })
                      }
                      className={
                        "px-4 py-2 rounded-full border mr-2 mb-2 " +
                        (active
                          ? "bg-sky-500 border-sky-500"
                          : isDark
                            ? "bg-[#0F172A] border-[#334155]"
                            : "bg-[#F8FAFC] border-[#CBD5E1]")
                      }
                    >
                      <Text
                        className={
                          bodyClassName +
                          " " +
                          (active ? "text-white font-semibold" : isDark ? "text-slate-100" : "text-[#2C3E50]")
                        }
                      >
                        ทุก {interval} ชั่วโมง
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text className={bodyClassName + " font-semibold text-gray-700 dark:text-slate-200 mb-2"}>
                เวลาเริ่มเตือน
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
                {HOUR_OPTIONS.map((hour) => {
                  const active = reminderSettings.startHour === hour;
                  return (
                    <TouchableOpacity
                      key={`start-${hour}`}
                      onPress={() => void updateReminderSettings({ startHour: hour })}
                      className={
                        "px-3 py-2 rounded-full border mr-2 " +
                        (active
                          ? "bg-sky-500 border-sky-500"
                          : isDark
                            ? "bg-[#0F172A] border-[#334155]"
                            : "bg-[#F8FAFC] border-[#CBD5E1]")
                      }
                    >
                      <Text
                        className={
                          bodyClassName +
                          " " +
                          (active ? "text-white font-semibold" : isDark ? "text-slate-100" : "text-[#2C3E50]")
                        }
                      >
                        {String(hour).padStart(2, "0")}:00
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text className={bodyClassName + " font-semibold text-gray-700 dark:text-slate-200 mb-2"}>
                เวลาสิ้นสุด
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-4">
                {HOUR_OPTIONS.map((hour) => {
                  const active = reminderSettings.endHour === hour;
                  return (
                    <TouchableOpacity
                      key={`end-${hour}`}
                      onPress={() => void updateReminderSettings({ endHour: hour })}
                      className={
                        "px-3 py-2 rounded-full border mr-2 " +
                        (active
                          ? "bg-sky-500 border-sky-500"
                          : isDark
                            ? "bg-[#0F172A] border-[#334155]"
                            : "bg-[#F8FAFC] border-[#CBD5E1]")
                      }
                    >
                      <Text
                        className={
                          bodyClassName +
                          " " +
                          (active ? "text-white font-semibold" : isDark ? "text-slate-100" : "text-[#2C3E50]")
                        }
                      >
                        {String(hour).padStart(2, "0")}:00
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text className={bodyClassName + " font-semibold text-gray-700 dark:text-slate-200 mb-2"}>
                วันที่ต้องการเตือน
              </Text>
              <View className="flex-row flex-wrap mb-4">
                {DAY_OPTIONS.map((day) => {
                  const active = reminderSettings.selectedDays.includes(day.value);
                  return (
                    <TouchableOpacity
                      key={day.value}
                      onPress={() => void toggleReminderDay(day.value)}
                      className={
                        "min-w-[52px] px-3 h-[48px] rounded-2xl border items-center justify-center mr-2 mb-2 " +
                        (active
                          ? "bg-sky-500 border-sky-500"
                          : isDark
                            ? "bg-[#0F172A] border-[#334155]"
                            : "bg-[#F8FAFC] border-[#CBD5E1]")
                      }
                    >
                      <Text
                        className={
                          bodyClassName +
                          " font-semibold " +
                          (active ? "text-white" : isDark ? "text-slate-100" : "text-[#2C3E50]")
                        }
                      >
                        {day.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View className="rounded-2xl bg-sky-50 dark:bg-slate-800/70 p-4">
                <Text className={bodyClassName + " font-semibold text-[#2C3E50] dark:text-slate-100"}>
                  เวลาที่ระบบจะเตือน
                </Text>
                <Text className={captionClassName + " text-gray-600 dark:text-slate-300 mt-1 leading-6"}>
                  {reminderPreview.join("  •  ")}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </GradientBackground>
  );
}
