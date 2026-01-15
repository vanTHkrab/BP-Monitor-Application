import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ScrollView,
    StatusBar,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BPChart } from '@/components/history/bp-chart';
import { BPHistoryCard, BPStatus } from '@/components/history/bp-history-card';
import { FilterPeriod, PeriodFilter } from '@/components/history/period-filter';
import { AppColors } from '@/constants/colors';

// Mock data
const mockChartData = [
  { date: '1 Jan', systolic: 118, diastolic: 76 },
  { date: '8 Jan', systolic: 122, diastolic: 80 },
  { date: '15 Jan', systolic: 115, diastolic: 75 },
  { date: '22 Jan', systolic: 132, diastolic: 84 },
  { date: '29 Jan', systolic: 125, diastolic: 82 },
];

const mockHistoryData = [
  {
    id: '1',
    date: 'วันนี้',
    time: '08.44',
    systolic: 112,
    diastolic: 78,
    heartRate: 80,
    status: 'normal' as BPStatus,
  },
  {
    id: '2',
    date: 'วันนี้',
    time: '08.44',
    systolic: 112,
    diastolic: 78,
    heartRate: 80,
    status: 'normal' as BPStatus,
  },
];

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedPeriod, setSelectedPeriod] = useState<FilterPeriod>('30วัน');
  const [viewMode, setViewMode] = useState<'chart' | 'list'>('chart');

  const handleOpenHistoryDetail = () => {
    router.push('/history-detail');
  };

  const handleExport = () => {
    // TODO: Export PDF/CSV
    console.log('Export pressed');
  };

  const handleRefresh = () => {
    // TODO: Refresh data
    console.log('Refresh pressed');
  };

  return (
    <View className="flex-1 bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor={AppColors.primary} />

      {/* Header */}
      <View className="bg-primary pb-4" style={{ paddingTop: insets.top + 10 }}>
        <View className="flex-row justify-center items-center px-5">
          <Text className="flex-1 text-xl font-bold text-gray-800 text-center">ประวัติความดัน</Text>
          <TouchableOpacity onPress={handleRefresh}>
            <Ionicons name="refresh" size={24} color={AppColors.gray700} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Period Filter */}
      <View className="bg-primary">
        <PeriodFilter
          selectedPeriod={selectedPeriod}
          onSelectPeriod={setSelectedPeriod}
        />
      </View>

      {/* View Mode Toggle */}
      <View className="flex-row mx-5 mb-4 bg-white rounded-[25px] p-1">
        <TouchableOpacity
          className={`flex-1 flex-row items-center justify-center py-2 rounded-[20px] gap-[6px] ${
            viewMode === 'chart' ? 'bg-primary' : ''
          }`}
          onPress={() => setViewMode('chart')}
        >
          <Ionicons
            name="stats-chart"
            size={18}
            color={viewMode === 'chart' ? AppColors.white : AppColors.gray500}
          />
          <Text
            className={`text-[13px] font-medium ${
              viewMode === 'chart' ? 'text-white' : 'text-gray-500'
            }`}
          >
            กราฟ
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={`flex-1 flex-row items-center justify-center py-2 rounded-[20px] gap-[6px] ${
            viewMode === 'list' ? 'bg-primary' : ''
          }`}
          onPress={() => setViewMode('list')}
        >
          <Ionicons
            name="list"
            size={18}
            color={viewMode === 'list' ? AppColors.white : AppColors.gray500}
          />
          <Text
            className={`text-[13px] font-medium ${
              viewMode === 'list' ? 'text-white' : 'text-gray-500'
            }`}
          >
            รายการ
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        className="flex-1 bg-gray-100 rounded-t-3xl"
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {viewMode === 'chart' ? (
          <>
            {/* BP Chart */}
            <BPChart data={mockChartData} />

            {/* Recent History Cards */}
            <Text className="text-base font-semibold text-gray-800 mx-5 mt-4 mb-3">ผลการวัดล่าสุด</Text>
            {mockHistoryData.map((item) => (
              <BPHistoryCard
                key={item.id}
                date={item.date}
                time={item.time}
                systolic={item.systolic}
                diastolic={item.diastolic}
                heartRate={item.heartRate}
                status={item.status}
                onPress={handleOpenHistoryDetail}
              />
            ))}
          </>
        ) : (
          <>
            {/* Full History List */}
            {mockHistoryData.map((item) => (
              <BPHistoryCard
                key={item.id}
                date={item.date}
                time={item.time}
                systolic={item.systolic}
                diastolic={item.diastolic}
                heartRate={item.heartRate}
                status={item.status}
                onPress={handleOpenHistoryDetail}
              />
            ))}
          </>
        )}

        {/* Export Button */}
        <TouchableOpacity
          className="flex-row justify-center items-center bg-white rounded-full py-3.5 mx-5 mt-4 gap-2 border border-gray-200"
          onPress={handleExport}
        >
          <Ionicons name="download-outline" size={20} color={AppColors.gray700} />
          <Text className="text-sm font-semibold text-gray-700">ส่งออกรายงาน PDF/CSV</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
