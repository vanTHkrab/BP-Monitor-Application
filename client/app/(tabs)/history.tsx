import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { BPReadingCard } from '@/components/bp-reading-card';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { useAppStore } from '@/store/useAppStore';
import { TimeFilter } from '@/types';
import { createExportFileWithRetry, ExportDataType, ExportFormat } from '@/utils/export-data';
import { getFontClass } from '@/utils/font-scale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { cssInterop } from 'nativewind';
import React, { useMemo, useState } from 'react';
import { Alert, Dimensions, Platform, ScrollView, Text, View } from 'react-native';
import { LineChart } from 'react-native-chart-kit';

const screenWidth = Dimensions.get('window').width;

cssInterop(LinearGradient, { className: 'style' });

export default function HistoryScreen() {
  const readings = useAppStore((s) => s.readings);
  const posts = useAppStore((s) => s.posts);
  const user = useAppStore((s) => s.user);
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-lg',
    small: 'text-xl',
    medium: 'text-[22px]',
    large: 'text-2xl',
    xlarge: 'text-[28px]',
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-xs',
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  });
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('30days');
  const [isExporting, setIsExporting] = useState(false);
  const showChart = true;
  const maxExportAttempts = 3;
  type ExportRangeKey = TimeFilter | 'all';

  const timeFilterTabs = [
    { key: '7days', label: '7 วัน' },
    { key: '30days', label: '30 วัน' },
    { key: '3months', label: '3 เดือน' },
    { key: '1year', label: '1 ปี' },
  ];

  const exportRangeOptions: Array<{ key: ExportRangeKey; label: string }> = [
    { key: '7days', label: '7 วัน' },
    { key: '30days', label: '30 วัน' },
    { key: '3months', label: '3 เดือน' },
    { key: '1year', label: '1 ปี' },
    { key: 'all', label: 'ทั้งหมด' },
  ];

  // Filter readings based on time filter
  const filterReadingsByRange = (rangeKey: ExportRangeKey, source: typeof readings) => {
    if (rangeKey === 'all') return source;

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

    return source.filter((r) => new Date(r.measuredAt) >= cutoffDate);
  };

  const filteredReadings = useMemo(() => {
    return filterReadingsByRange(timeFilter, readings);
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
      const readingsForExport = dataType === 'readings' ? filterReadingsByRange(rangeKey, readings) : [];
      const fileUri = await createExportFileWithRetry(
        {
          dataType,
          format,
          readings: readingsForExport,
          posts,
          userName: user ? `${user.firstname} ${user.lastname}`.trim() : undefined,
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
        onPress: () => {
          if (option.key !== 'all') {
            setTimeFilter(option.key);
          }
          selectExportFormat('readings', option.key);
        },
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
              className="px-6 py-2.5 rounded-xl"
            >
              <Text className={titleClassName + " font-bold text-white"}>ประวัติความดัน</Text>
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
                className="p-4 rounded-3xl"
              >
                {/* Legend */}
                <View className="flex-row justify-center gap-6 mb-2">
                  <View className="flex-row items-center">
                    <View className="w-2.5 h-2.5 rounded-full bg-[#5DADE2] mr-1.5" />
                    <Text className={bodyClassName + " text-gray-500 dark:text-slate-300 font-medium"}>ค่าบน (SYS)</Text>
                  </View>
                  <View className="flex-row items-center">
                    <View className="w-2.5 h-2.5 rounded-full bg-[#8E44AD] mr-1.5" />
                    <Text className={bodyClassName + " text-gray-500 dark:text-slate-300 font-medium"}>ค่าล่าง (DIA)</Text>
                  </View>
                </View>

                <View className="my-2 rounded-2xl overflow-hidden">
                  <LineChart
                    data={chartData}
                    width={screenWidth - 64}
                    height={180}
                    chartConfig={chartConfig}
                    bezier
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
                </View>

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
                className="rounded-2xl overflow-hidden"
              >
                <LinearGradient
                  colors={['#EBF5FB', '#D4E6F1']}
                  className="flex-row items-center justify-center py-3.5 rounded-2xl"
                >
                  <View className="mr-2">
                    <Ionicons name="list" size={20} color="#3498DB" />
                  </View>
                  <Text className="text-[#3498DB] font-semibold text-[15px]">
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
              onPress={startExportFlow}
              className="rounded-2xl overflow-hidden shadow-lg shadow-black/20"
            >
              <LinearGradient
                colors={['#2C3E50', '#1a1a2e']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                className="flex-row items-center justify-center py-4 rounded-2xl gap-2"
              >
                <Ionicons name="download-outline" size={22} color="white" />
                <Text className="text-white font-semibold text-[15px]">ส่งออกรายงาน PDF/CSV</Text>
              </LinearGradient>
            </AnimatedPressable>
          </View>
        </FadeInView>

        <View className="h-[100px]" />
      </ScrollView>
    </GradientBackground>
  );
}
