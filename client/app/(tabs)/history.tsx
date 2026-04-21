import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { BPReadingCard } from '@/components/bp-reading-card';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { useAppStore } from '@/store/useAppStore';
import { TimeFilter } from '@/types';
import { createExportFileWithRetry, ExportDataType, ExportFormat } from '@/utils/export-data';
import { getFontClass, getFontNumber } from '@/utils/font-scale';
import {
  buildReminderTimelineForDate,
  loadReminderSettings,
  type ReminderSettings,
} from '@/utils/reminders';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { cssInterop } from 'nativewind';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });

export default function HistoryScreen() {
  const readings = useAppStore((s) => s.readings);
  const posts = useAppStore((s) => s.posts);
  const user = useAppStore((s) => s.user);
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const insets = useSafeAreaInsets();
  const [reminderSettings, setReminderSettings] =
    useState<ReminderSettings | null>(null);
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
  const captionClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-[11px]',
    small: 'text-xs',
    medium: 'text-sm',
    large: 'text-base',
    xlarge: 'text-lg',
  });
  const chartAxisFontSize = getFontNumber(fontSizePreference, {
    xsmall: 10,
    small: 11,
    medium: 12,
    large: 13,
    xlarge: 14,
  });
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('30days');
  const [isExporting, setIsExporting] = useState(false);
  const showChart = true;
  const maxExportAttempts = 3;
  type ExportRangeKey = TimeFilter | 'all';

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const hydrateReminderSettings = async () => {
        const loaded = await loadReminderSettings(user?.id);
        if (active) {
          setReminderSettings(loaded);
        }
      };

      void hydrateReminderSettings();

      return () => {
        active = false;
      };
    }, [user?.id]),
  );

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

  const todayReminderTimeline = useMemo(
    () =>
      reminderSettings
        ? buildReminderTimelineForDate({
            settings: reminderSettings,
            readings,
            date: new Date(),
          })
        : [],
    [readings, reminderSettings],
  );

  const completedReminderCount = todayReminderTimeline.filter(
    (slot) => slot.status === 'completed',
  ).length;
  const missedReminderCount = todayReminderTimeline.filter(
    (slot) => slot.status === 'missed',
  ).length;

  const recentChartReadings = useMemo(() => {
    return [...filteredReadings]
      .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
      .slice(-7);
  }, [filteredReadings]);

  const chartLineData = useMemo(() => {
    if (recentChartReadings.length === 0) {
      return null;
    }

    return {
      systolic: recentChartReadings.map((r) => {
        const date = new Date(r.measuredAt);
        return {
          value: r.systolic,
          label: `${date.getDate()}/${date.getMonth() + 1}`,
        };
      }),
      diastolic: recentChartReadings.map((r) => ({
        value: r.diastolic,
      })),
    };
  }, [recentChartReadings]);

  const chartMaxValue = useMemo(() => {
    if (recentChartReadings.length === 0) {
      return 160;
    }

    const highestValue = Math.max(
      ...recentChartReadings.flatMap((reading) => [
        reading.systolic,
        reading.diastolic,
      ]),
    );
    return Math.max(140, Math.ceil((highestValue + 10) / 20) * 20);
  }, [recentChartReadings]);

  const latestChartReading = recentChartReadings[recentChartReadings.length - 1];

  const chartAccentCardClassName =
    (isDark
      ? 'bg-[#111827] border border-[#334155]'
      : 'bg-[#EBF5FB] border border-[#D6EAF8]') +
    ' rounded-2xl px-4 py-3 mb-3 flex-row items-center justify-between';

  const chartAxisColor = isDark ? '#64748B' : '#7F8C8D';
  const chartRuleColor = isDark ? '#334155' : '#E2E8F0';
  const chartTextColor = isDark ? '#E2E8F0' : '#2C3E50';

  const chartData = useMemo(() => {
    if (recentChartReadings.length === 0) {
      return null;
    }

    return recentChartReadings.map(r => {
        const date = new Date(r.measuredAt);
        return `${date.getDate()}/${date.getMonth() + 1}`;
    });
  }, [recentChartReadings]);

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
    <GradientBackground safeArea={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 108,
        }}
      >
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

        <FadeInView delay={250}>
          <View className="mx-4 rounded-3xl overflow-hidden shadow-lg mb-5 bg-white dark:bg-slate-900 border border-transparent dark:border-slate-700">
            <LinearGradient
              colors={isDark ? ['#0F172A', '#111827'] : ['#FFFFFF', '#F8FAFC']}
              className="p-4 rounded-3xl"
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1 pr-3">
                  <Text className={titleClassName + ' font-bold text-gray-800 dark:text-slate-100'}>
                    เช็กรอบวัดของวันนี้
                  </Text>
                  <Text className={captionClassName + ' mt-1 leading-5 text-gray-500 dark:text-slate-300'}>
                    ติดตามตามเวลาแจ้งเตือนของวันนี้ วัดแล้วเป็นสีเขียว ยังไม่วัดเป็นสีแดง และรอบที่ยังไม่ถึงเวลาจะรอไว้ก่อน
                  </Text>
                </View>
                <View className={(isDark ? 'bg-[#111827]' : 'bg-[#EBF5FB]') + ' rounded-2xl px-3 py-2'}>
                  <Text className={captionClassName + ' font-semibold text-gray-600 dark:text-slate-300'}>
                    สำเร็จ {completedReminderCount}/{todayReminderTimeline.length}
                  </Text>
                </View>
              </View>

              {todayReminderTimeline.length > 0 ? (
                <>
                  <View className="flex-row mt-3">
                    <View className="rounded-full bg-[#DCFCE7] px-3 py-1 mr-2">
                      <Text className={captionClassName + ' font-semibold text-[#15803D]'}>
                        วัดแล้ว {completedReminderCount}
                      </Text>
                    </View>
                    <View className="rounded-full bg-[#FEE2E2] px-3 py-1 mr-2">
                      <Text className={captionClassName + ' font-semibold text-[#DC2626]'}>
                        ค้างวัด {missedReminderCount}
                      </Text>
                    </View>
                    <View className="rounded-full bg-[#E2E8F0] px-3 py-1">
                      <Text className={captionClassName + ' font-semibold text-[#475569]'}>
                        ยังไม่ถึงเวลา
                      </Text>
                    </View>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    className="mt-4"
                    contentContainerStyle={{ paddingRight: 8 }}
                  >
                    {todayReminderTimeline.map((slot) => {
                      const statusBg =
                        slot.status === 'completed'
                          ? 'bg-[#DCFCE7] border-[#86EFAC]'
                          : slot.status === 'missed'
                            ? 'bg-[#FEE2E2] border-[#FCA5A5]'
                            : isDark
                              ? 'bg-[#1E293B] border-[#334155]'
                              : 'bg-[#EFF6FF] border-[#BFDBFE]';
                      const statusText =
                        slot.status === 'completed'
                          ? 'text-[#15803D]'
                          : slot.status === 'missed'
                            ? 'text-[#DC2626]'
                            : isDark
                              ? 'text-slate-300'
                              : 'text-[#2563EB]';
                      const detailText =
                        slot.status === 'completed'
                          ? slot.minutesLate && slot.minutesLate > 0
                            ? `วัด ${slot.minutesLate} นาทีหลังเตือน`
                            : 'วัดตรงรอบแล้ว'
                          : slot.status === 'missed'
                            ? 'ยังไม่ได้วัด'
                            : 'รอถึงเวลา';

                      return (
                        <View
                          key={slot.occurrenceKey}
                          className={`w-[132px] rounded-2xl border p-3 mr-3 ${statusBg}`}
                        >
                          <View className="flex-row items-center justify-between">
                            <Text className={bodyClassName + ' font-bold ' + statusText}>
                              {slot.label}
                            </Text>
                            <View
                              className={
                                'w-3 h-3 rounded-full ' +
                                (slot.status === 'completed'
                                  ? 'bg-[#22C55E]'
                                  : slot.status === 'missed'
                                    ? 'bg-[#EF4444]'
                                    : 'bg-[#94A3B8]')
                              }
                            />
                          </View>
                          <Text className={captionClassName + ' mt-2 leading-5 ' + statusText}>
                            {detailText}
                          </Text>
                          {slot.matchedReadingAt ? (
                            <Text className={captionClassName + ' mt-1 ' + statusText}>
                              เวลา {slot.matchedReadingAt.toLocaleTimeString('th-TH', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </Text>
                          ) : null}
                        </View>
                      );
                    })}
                  </ScrollView>
                </>
              ) : (
                <View
                  className={
                    (isDark ? 'bg-[#111827] border border-[#334155]' : 'bg-[#F8FAFC] border border-[#E2E8F0]') +
                    ' rounded-2xl mt-4 p-4'
                  }
                >
                  <Text className={bodyClassName + ' font-semibold text-gray-800 dark:text-slate-100'}>
                    วันนี้ยังไม่มีรอบแจ้งเตือน
                  </Text>
                  <Text className={captionClassName + ' mt-1 leading-5 text-gray-500 dark:text-slate-300'}>
                    ถ้าต้องการให้หมวดนี้ทำงาน ให้เปิดการแจ้งเตือนและกำหนดวันหรือช่วงเวลาในหน้าตั้งค่า
                  </Text>
                </View>
              )}
            </LinearGradient>
          </View>
        </FadeInView>

        {/* Chart */}
        {showChart && chartLineData && chartData && (
          <ScaleOnMount delay={320}>
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

                {latestChartReading && (
                  <View className={chartAccentCardClassName}>
                    <View className="flex-1 pr-3">
                      <Text className={(isDark ? 'text-slate-300' : 'text-[#5B7285]') + ' ' + bodyClassName + ' font-medium'}>
                        ค่าล่าสุด
                      </Text>
                      <Text className={(isDark ? 'text-slate-500' : 'text-[#7F8C8D]') + ' ' + bodyClassName}>
                        อัปเดตจากการวัดครั้งล่าสุด
                      </Text>
                    </View>
                    <View className="rounded-full bg-[#5DADE2] px-4 py-2">
                      <Text className={bodyClassName + ' text-white font-bold'}>
                        {latestChartReading.systolic}/{latestChartReading.diastolic}
                      </Text>
                    </View>
                  </View>
                )}

                <View className="my-2 rounded-2xl overflow-hidden">
                  <LineChart
                    data={chartLineData.systolic}
                    data2={chartLineData.diastolic}
                    height={220}
                    maxValue={chartMaxValue}
                    noOfSections={4}
                    adjustToWidth
                    initialSpacing={18}
                    endSpacing={18}
                    spacing={36}
                    color1="#5DADE2"
                    color2="#8E44AD"
                    thickness1={4}
                    thickness2={3}
                    dataPointsRadius1={5}
                    dataPointsRadius2={4}
                    dataPointsColor1="#5DADE2"
                    dataPointsColor2="#8E44AD"
                    hideDataPoints={false}
                    hideDataPoints2={false}
                    curved
                    areaChart
                    areaChart1
                    startFillColor1="#5DADE2"
                    endFillColor1="#5DADE2"
                    startOpacity1={0.2}
                    endOpacity1={0.03}
                    startFillColor2="#8E44AD"
                    endFillColor2="#8E44AD"
                    startOpacity2={0.08}
                    endOpacity2={0.01}
                    hideRules={false}
                    rulesColor={chartRuleColor}
                    rulesThickness={1}
                    xAxisColor={chartRuleColor}
                    yAxisColor="transparent"
                    xAxisThickness={1}
                    yAxisThickness={0}
                    yAxisTextStyle={{ color: chartAxisColor, fontSize: chartAxisFontSize }}
                    xAxisLabelTextStyle={{ color: chartAxisColor, fontSize: chartAxisFontSize }}
                    xAxisLabelsHeight={26}
                    xAxisLabelTexts={chartData}
                    textColor={chartTextColor}
                    textFontSize={chartAxisFontSize}
                    disableScroll
                    focusEnabled={false}
                    stripColor={isDark ? '#475569' : '#CBD5E1'}
                    stripWidth={2}
                    stripHeight={180}
                    pointerConfig={{
                      pointerStripUptoDataPoint: true,
                      pointerStripColor: isDark ? '#475569' : '#CBD5E1',
                      pointerStripWidth: 2,
                      radius: 6,
                      pointerColor: '#5DADE2',
                      activatePointersOnLongPress: true,
                      persistPointer: false,
                      autoAdjustPointerLabelPosition: true,
                      pointerLabelComponent: (items: Array<{ value?: number }>) => (
                        <View
                          style={{
                            backgroundColor: isDark ? '#0F172A' : '#FFFFFF',
                            borderColor: isDark ? '#334155' : '#D6EAF8',
                            borderWidth: 1,
                            borderRadius: 14,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                          }}
                        >
                          <Text style={{ color: chartTextColor, fontWeight: '700', fontSize: chartAxisFontSize + 1 }}>
                            SYS {items[0]?.value ?? '-'} / DIA {items[1]?.value ?? '-'}
                          </Text>
                        </View>
                      ),
                    }}
                  />
                </View>
              </LinearGradient>
            </View>
          </ScaleOnMount>
        )}

        {/* Readings List */}
        <FadeInView delay={400}>
          <View className="px-4">
            <Text className={titleClassName + " font-bold text-gray-800 dark:text-slate-100 mb-3"}>รายการล่าสุด</Text>
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
                  <Text className={bodyClassName + " text-[#3498DB] font-semibold"}>
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
                <Text className={bodyClassName + " text-white font-semibold"}>ส่งออกรายงาน PDF/CSV</Text>
              </LinearGradient>
            </AnimatedPressable>
          </View>
        </FadeInView>

        <View className="h-[100px]" />
      </ScrollView>
    </GradientBackground>
  );
}
