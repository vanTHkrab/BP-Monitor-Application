import { GradientBackground } from '@/components/gradient-background';
import { Colors } from '@/constants/colors';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';

export default function SettingsScreen() {
  const [notifications, setNotifications] = useState(true);
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [autoBackup, setAutoBackup] = useState(true);

  const themePreference = useAppStore((s) => s.themePreference);
  const setThemePreference = useAppStore((s) => s.setThemePreference);
  const headerIconColor = themePreference === 'dark' ? '#E2E8F0' : Colors.text.primary;

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
          
          <TouchableOpacity className="flex-row items-center bg-white dark:bg-slate-900 p-4 rounded-xl mb-3 border border-sky-200 dark:border-slate-700">
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
