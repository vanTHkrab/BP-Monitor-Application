import { BPReadingCard } from '@/components/bp-reading-card';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { Colors } from '@/constants/colors';
import { useAppStore } from '@/store/useAppStore';
import { TimeFilter } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function HistoryListScreen() {
  const readings = useAppStore((s) => s.readings);
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const headerIconColor = isDark ? '#E2E8F0' : Colors.text.primary;
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('30days');

  const timeFilterTabs = [
    { key: '7days', label: '7 วัน' },
    { key: '30days', label: '30 วัน' },
    { key: '3months', label: '3 เดือน' },
    { key: '1year', label: '1 ปี' },
  ];

  // Filter readings based on time filter
  const filteredReadings = React.useMemo(() => {
    const now = new Date();
    let cutoffDate = new Date();
    
    switch (timeFilter) {
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
    }
    
    return readings.filter(r => new Date(r.measuredAt) >= cutoffDate);
  }, [readings, timeFilter]);

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="flex-row items-center justify-center px-4 py-4">
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ position: 'absolute', left: 16, padding: 4 }}
          >
            <Ionicons name="arrow-back" size={28} color={headerIconColor} />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-800 dark:text-slate-100 text-center">ประวัติความดัน</Text>
          <TouchableOpacity style={{ position: 'absolute', right: 16, padding: 4 }}>
            <Ionicons name="information-circle-outline" size={26} color={headerIconColor} />
          </TouchableOpacity>
        </View>

        {/* Time Filter Tabs */}
        <View className="px-4 mb-4">
          <TabButtons
            tabs={timeFilterTabs}
            activeTab={timeFilter}
            onTabChange={(key) => setTimeFilter(key as TimeFilter)}
            variant="pill"
          />
        </View>

        {/* Readings List */}
        <View className="px-4">
          {filteredReadings.length > 0 ? (
            filteredReadings.map((reading) => (
              <BPReadingCard
                key={reading.id}
                reading={reading}
                showFullDate
                onPress={() => {/* TODO: Navigate to detail */}}
              />
            ))
          ) : (
            <View className="bg-white dark:bg-slate-900 rounded-2xl p-8 items-center border border-transparent dark:border-slate-700">
              <Ionicons
                name="document-text-outline"
                size={48}
                color={isDark ? '#94A3B8' : Colors.text.secondary}
              />
              <Text className="text-lg font-bold text-gray-800 dark:text-slate-100 mt-4">ยังไม่มีประวัติการวัด</Text>
              <Text className="text-gray-500 dark:text-slate-300 text-center mt-2">
                เริ่มต้นบันทึกค่าความดันของคุณ
              </Text>
            </View>
          )}
        </View>

        {/* Bottom Spacing */}
        <View className="h-8" />
      </ScrollView>
    </GradientBackground>
  );
}
