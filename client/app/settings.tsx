import { GradientBackground } from '@/components/gradient-background';
import { Colors } from '@/constants/colors';
import { useAppStore } from '@/store/useAppStore';
import { createExportFileWithRetry, ExportDataType, ExportFormat } from '@/utils/export-data';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useState } from 'react';
import { Alert, Platform, ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [autoBackup, setAutoBackup] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const themePreference = useAppStore((s) => s.themePreference);
  const setThemePreference = useAppStore((s) => s.setThemePreference);
  const readings = useAppStore((s) => s.readings);
  const posts = useAppStore((s) => s.posts);
  const user = useAppStore((s) => s.user);
  const headerIconColor = themePreference === 'dark' ? '#E2E8F0' : Colors.text.primary;
  const maxExportAttempts = 3;
  type ExportRangeKey = '7days' | '30days' | '3months' | '1year' | 'all';

  const exportRangeOptions: Array<{ key: ExportRangeKey; label: string }> = [
    { key: '7days', label: '7 วัน' },
    { key: '30days', label: '30 วัน' },
    { key: '3months', label: '3 เดือน' },
    { key: '1year', label: '1 ปี' },
    { key: 'all', label: 'ทั้งหมด' },
  ];

  const filterReadingsByRange = (rangeKey: ExportRangeKey) => {
    if (rangeKey === 'all') return readings;

    const now = new Date();
    const cutoffDate = new Date();

    switch (rangeKey) {
      case '7days':
        cutoffDate.setDate(now.getDate() - 7);
        break;
      case '30days':
        cutoffDate.setDate(now.getDate() - 30);
        break;
      case '3months':
        cutoffDate.setMonth(now.getMonth() - 3);
        break;
      case '1year':
        cutoffDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        break;
    }

    return readings.filter((r) => new Date(r.measuredAt) >= cutoffDate);
  };

  const handleExport = async (dataType: ExportDataType, format: ExportFormat, rangeKey: ExportRangeKey) => {
    if (isExporting) {
      Alert.alert('กำลังส่งออก', 'กรุณารอสักครู่');
      return;
    }

    if (Platform.OS === 'web') {
      Alert.alert('ไม่รองรับ', 'การส่งออกไฟล์ยังไม่รองรับบนเวอร์ชันเว็บ');
      return;
    }

    setIsExporting(true);
    try {
      const readingsForExport = dataType === 'readings' ? filterReadingsByRange(rangeKey) : [];
      const fileUri = await createExportFileWithRetry(
        {
          dataType,
          format,
          readings: readingsForExport,
          posts,
          userName: user?.name,
        },
        maxExportAttempts
      );

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('ไม่รองรับ', 'อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์');
        return;
      }

      await Sharing.shareAsync(fileUri);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถส่งออกข้อมูลได้';
      Alert.alert('เกิดข้อผิดพลาด', message);
    } finally {
      setIsExporting(false);
    }
  };

  const selectExportFormat = (dataType: ExportDataType, rangeKey: ExportRangeKey) => {
    Alert.alert('เลือก Format', 'กรุณาเลือกประเภทไฟล์ที่ต้องการ', [
      { text: 'PDF', onPress: () => void handleExport(dataType, 'pdf', rangeKey) },
      { text: 'CSV', onPress: () => void handleExport(dataType, 'csv', rangeKey) },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };

  const selectExportRange = (dataType: ExportDataType) => {
    if (dataType !== 'readings') {
      selectExportFormat(dataType, 'all');
      return;
    }

    Alert.alert('เลือกช่วงเวลา', 'กรุณาเลือกช่วงเวลาที่ต้องการส่งออก', [
      ...exportRangeOptions.map((option) => ({
        text: option.label,
        onPress: () => selectExportFormat('readings', option.key),
      })),
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };

  const startExportFlow = () => {
    if (isExporting) {
      Alert.alert('กำลังส่งออก', 'กรุณารอสักครู่');
      return;
    }

    Alert.alert('เลือกข้อมูลที่ต้องการส่งออก', 'กรุณาเลือกประเภทข้อมูล', [
      { text: 'ค่าความดัน', onPress: () => selectExportRange('readings') },
      { text: 'โพสต์ชุมชน', onPress: () => selectExportRange('posts') },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
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
        <Text className="text-gray-800 dark:text-slate-100 font-medium">{title}</Text>
        {subtitle && <Text className="text-gray-500 dark:text-slate-300 text-sm">{subtitle}</Text>}
      </View>
      {showToggle && onValueChange && (
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: '#D1D5DB', true: Colors.primary.skyBlue }}
          thumbColor={value ? Colors.primary.blue : '#f4f3f4'}
        />
      )}
    </View>
  );

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Ionicons name="arrow-back" size={28} color={headerIconColor} />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-800 dark:text-slate-100 flex-1 text-center">ตั้งค่าแอปพลิเคชั่น</Text>
          <View className="w-7" />
        </View>

        {/* Settings */}
        <View className="px-4">
          {/* Notifications Section */}
          <Text className="text-lg font-bold text-gray-800 dark:text-slate-100 mb-3">การแจ้งเตือน</Text>
          
          <SettingItem
            icon="notifications-outline"
            title="การแจ้งเตือน"
            subtitle="รับการแจ้งเตือนจากแอป"
            value={notifications}
            onValueChange={setNotifications}
          />
          
          <SettingItem
            icon="alarm-outline"
            title="เตือนวัดความดัน"
            subtitle="เตือนให้วัดความดันทุกวัน"
            value={reminderEnabled}
            onValueChange={setReminderEnabled}
          />

          {/* Display Section */}
          <Text className="text-lg font-bold text-gray-800 dark:text-slate-100 mb-3 mt-4">การแสดงผล</Text>
          
          <SettingItem
            icon="moon-outline"
            title="โหมดมืด"
            subtitle="เปลี่ยนเป็นธีมมืด"
            value={themePreference === 'dark'}
            onValueChange={(value) => void setThemePreference(value ? 'dark' : 'light')}
          />

          {/* Data Section */}
          <Text className="text-lg font-bold text-gray-800 dark:text-slate-100 mb-3 mt-4">ข้อมูล</Text>
          
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
              <Ionicons name="download-outline" size={22} color={Colors.primary.blue} />
            </View>
            <View className="flex-1">
              <Text className="text-gray-800 dark:text-slate-100 font-medium">ส่งออกข้อมูล</Text>
              <Text className="text-gray-500 dark:text-slate-300 text-sm">ดาวน์โหลดข้อมูลทั้งหมด</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.text.secondary} />
          </TouchableOpacity>
          
          <TouchableOpacity className="flex-row items-center bg-red-50 dark:bg-red-950/40 p-4 rounded-xl mb-3 border border-red-200 dark:border-red-900">
            <View className="w-10 h-10 bg-red-100 dark:bg-red-900/50 rounded-full items-center justify-center mr-3">
              <Ionicons name="trash-outline" size={22} color={Colors.status.high} />
            </View>
            <View className="flex-1">
              <Text className="text-red-600 dark:text-red-300 font-medium">ลบข้อมูลทั้งหมด</Text>
              <Text className="text-red-400 dark:text-red-200/80 text-sm">ลบข้อมูลการวัดทั้งหมด</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={Colors.status.high} />
          </TouchableOpacity>
        </View>

        <View className="h-8" />
      </ScrollView>
    </GradientBackground>
  );
}
