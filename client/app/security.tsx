import { GradientBackground } from '@/components/gradient-background';
import { MenuItem } from '@/components/menu-item';
import { Colors } from '@/constants/colors';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function SecurityScreen() {
  const themePreference = useAppStore((s) => s.themePreference);
  const headerIconColor = themePreference === 'dark' ? '#E2E8F0' : Colors.text.primary;
  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center px-4 py-4">
          <TouchableOpacity onPress={() => router.back()} className="mr-4">
            <Ionicons name="arrow-back" size={28} color={headerIconColor} />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-800 dark:text-slate-100 flex-1 text-center">ความปลอดภัย</Text>
          <View className="w-7" />
        </View>

        {/* Security Options */}
        <View className="px-4">
          <MenuItem
            icon="key-outline"
            title="เปลี่ยนรหัสผ่าน"
            onPress={() => {/* TODO */}}
          />
          
          <MenuItem
            icon="finger-print-outline"
            title="ล็อกอินด้วยลายนิ้วมือ"
            onPress={() => {/* TODO */}}
          />
          
          <MenuItem
            icon="phone-portrait-outline"
            title="การยืนยันสองขั้นตอน"
            onPress={() => {/* TODO */}}
          />
          
          <MenuItem
            icon="time-outline"
            title="ประวัติการเข้าสู่ระบบ"
            onPress={() => {/* TODO */}}
          />
          
          <MenuItem
            icon="log-out-outline"
            title="ออกจากระบบทุกอุปกรณ์"
            onPress={() => {/* TODO */}}
          />
        </View>

        {/* Info */}
        <View className="px-4 mt-6">
          <View className="bg-blue-50 dark:bg-slate-900 rounded-xl p-4 border border-blue-200 dark:border-slate-700">
            <View className="flex-row items-center mb-2">
              <Ionicons name="shield-checkmark" size={24} color={Colors.primary.blue} />
              <Text className="text-blue-800 dark:text-slate-100 font-bold ml-2">ข้อมูลของคุณปลอดภัย</Text>
            </View>
            <Text className="text-blue-700 dark:text-slate-300 text-sm">
              เราใช้การเข้ารหัสมาตรฐานสูงสุดเพื่อปกป้องข้อมูลสุขภาพของคุณ
            </Text>
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>
    </GradientBackground>
  );
}
