import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { BPReadingCard } from '@/components/bp-reading-card';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { useAppStore } from '@/store/useAppStore';
import { TimeFilter } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Dimensions, ScrollView, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';

const screenWidth = Dimensions.get('window').width;

export default function HistoryScreen() {
  const { readings } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('30days');
  const [showChart, setShowChart] = useState(true);

  const timeFilterTabs = [
    { key: '7days', label: '7 วัน' },
    { key: '30days', label: '30 วัน' },
    { key: '3months', label: '3 เดือน' },
    { key: '1year', label: '1 ปี' },
  ];

  // Filter readings based on time filter
  const filteredReadings = useMemo(() => {
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

  // Prepare chart data
  const chartData = useMemo(() => {
    const sortedReadings = [...filteredReadings]
      .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
      .slice(-7);

    if (sortedReadings.length === 0) {
      return null;
    }

    return {
      labels: sortedReadings.map(r => {
        const date = new Date(r.measuredAt);
        return `${date.getDate()}/${date.getMonth() + 1}`;
      }),
      datasets: [
        {
          data: sortedReadings.map(r => r.systolic),
          color: (opacity = 1) => `rgba(93, 173, 226, ${opacity})`,
          strokeWidth: 3,
        },
        {
          data: sortedReadings.map(r => r.diastolic),
          color: (opacity = 1) => `rgba(142, 68, 173, ${opacity})`,
          strokeWidth: 3,
        },
      ],
      legend: ['ค่าบน (SYS)', 'ค่าล่าง (DIA)'],
    };
  }, [filteredReadings]);

  const chartConfig = {
    backgroundColor: isDark ? '#0F172A' : '#ffffff',
    backgroundGradientFrom: isDark ? '#0F172A' : '#ffffff',
    backgroundGradientTo: isDark ? '#111827' : '#F8FAFC',
    decimalPlaces: 0,
    color: (opacity = 1) => (isDark ? `rgba(226, 232, 240, ${opacity})` : `rgba(44, 62, 80, ${opacity})`),
    labelColor: (opacity = 1) => (isDark ? `rgba(148, 163, 184, ${opacity})` : `rgba(127, 140, 141, ${opacity})`),
    style: {
      borderRadius: 16,
    },
    propsForDots: {
      r: '5',
      strokeWidth: '2',
      stroke: '#5DADE2',
    },
    propsForBackgroundLines: {
      strokeDasharray: '',
      stroke: isDark ? '#334155' : '#E8E8E8',
      strokeWidth: 1,
    },
  };

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeInView delay={100}>
          <View className="flex-row items-center justify-center px-4 py-4 relative">
            <LinearGradient
              colors={['#5DADE2', '#3498DB']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{
                paddingHorizontal: 24,
                paddingVertical: 10,
                borderRadius: 12,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: 'bold', color: 'white' }}>ประวัติความดัน</Text>
            </LinearGradient>
            {/* <AnimatedPressable className="absolute right-4 p-2" onPress={() => {}}>
              <Ionicons name="refresh" size={24} color={Colors.primary.blue} />
            </AnimatedPressable> */}
          </View>
        </FadeInView>

        {/* Time Filter Tabs */}
        <FadeInView delay={200}>
          <View className="px-4 mb-4">
            <TabButtons
              tabs={timeFilterTabs}
              activeTab={timeFilter}
              onTabChange={(key) => setTimeFilter(key as TimeFilter)}
              variant="pill"
            />
          </View>
        </FadeInView>

        {/* Chart */}
        {showChart && chartData && (
          <ScaleOnMount delay={300}>
            <View className="mx-4 rounded-3xl overflow-hidden shadow-lg mb-5 bg-white dark:bg-slate-900 border border-transparent dark:border-slate-700">
              <LinearGradient
                colors={isDark ? ['#0F172A', '#111827'] : ['#FFFFFF', '#F8FAFC']}
                style={{ padding: 16, borderRadius: 24 }}
              >
                {/* Legend */}
                <View className="flex-row justify-center gap-6 mb-2">
                  <View className="flex-row items-center">
                    <View className="w-2.5 h-2.5 rounded-full bg-[#5DADE2] mr-1.5" />
                    <Text className="text-xs text-gray-500 dark:text-slate-300 font-medium">ค่าบน (SYS)</Text>
                  </View>
                  <View className="flex-row items-center">
                    <View className="w-2.5 h-2.5 rounded-full bg-[#8E44AD] mr-1.5" />
                    <Text className="text-xs text-gray-500 dark:text-slate-300 font-medium">ค่าล่าง (DIA)</Text>
                  </View>
                </View>

                <LineChart
                  data={chartData}
                  width={screenWidth - 64}
                  height={180}
                  chartConfig={chartConfig}
                  bezier
                  style={{ marginVertical: 8, borderRadius: 16 }}
                  withInnerLines={true}
                  withOuterLines={false}
                  withVerticalLines={false}
                  withHorizontalLines={true}
                  withVerticalLabels={true}
                  withHorizontalLabels={true}
                  fromZero={false}
                  yAxisSuffix=""
                  yAxisInterval={1}
                />

                {/* Latest reading tooltip */}
                {filteredReadings.length > 0 && (
                  <View className="absolute top-4 right-4 bg-[#5DADE2] px-3 py-1.5 rounded-xl">
                    <Text className="text-white text-xs font-semibold">
                      ล่าสุด: {filteredReadings[0].systolic}/{filteredReadings[0].diastolic}
                    </Text>
                  </View>
                )}
              </LinearGradient>
            </View>
          </ScaleOnMount>
        )}

        {/* Readings List */}
        <FadeInView delay={400}>
          <View className="px-4">
            <Text className="text-lg font-bold text-gray-800 dark:text-slate-100 mb-3">รายการล่าสุด</Text>
            {filteredReadings.slice(0, 3).map((reading, index) => (
              <FadeInView key={reading.id} delay={450 + index * 100}>
                <BPReadingCard reading={reading} onPress={() => {}} />
              </FadeInView>
            ))}
          </View>
        </FadeInView>

        {/* View All Button */}
        {filteredReadings.length > 3 && (
          <FadeInView delay={600}>
            <View className="px-4 mb-3">
              <AnimatedPressable
                onPress={() => router.push('/history-list' as Href)}
                style={{ borderRadius: 16, overflow: 'hidden' }}
              >
                <LinearGradient
                  colors={['#EBF5FB', '#D4E6F1']}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 14,
                    borderRadius: 16,
                  }}
                >
                  <Ionicons name="list" size={20} color="#3498DB" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#3498DB', fontWeight: '600', fontSize: 15 }}>
                    ดูทั้งหมด ({filteredReadings.length} รายการ)
                  </Text>
                </LinearGradient>
              </AnimatedPressable>
            </View>
          </FadeInView>
        )}

        {/* Export Button */}
        <FadeInView delay={700}>
          <View className="px-4 mb-3">
            <AnimatedPressable
              onPress={() => {}}
              style={{
                borderRadius: 16,
                overflow: 'hidden',
                shadowColor: '#2C3E50',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 6,
              }}
            >
              <LinearGradient
                colors={['#2C3E50', '#1a1a2e']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingVertical: 16,
                  borderRadius: 16,
                  gap: 8,
                }}
              >
                <Ionicons name="download-outline" size={22} color="white" />
                <Text style={{ color: 'white', fontWeight: '600', fontSize: 15 }}>ส่งออกรายงาน PDF/CSV</Text>
              </LinearGradient>
            </AnimatedPressable>
          </View>
        </FadeInView>

        <View className="h-[100px]" />
      </ScrollView>
    </GradientBackground>
  );
}
