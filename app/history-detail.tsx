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

import { BPHistoryCard, BPStatus } from '@/components/history/bp-history-card';
import { FilterPeriod, PeriodFilter } from '@/components/history/period-filter';
import { AppColors } from '@/constants/colors';

// Extended mock data for full history
const fullHistoryData = [
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
    date: 'เมื่อวาน',
    time: '08.44',
    systolic: 105,
    diastolic: 58,
    heartRate: 110,
    status: 'low' as BPStatus,
  },
  {
    id: '3',
    date: '5/12/2568',
    time: '08.44',
    systolic: 158,
    diastolic: 98,
    heartRate: 80,
    status: 'high' as BPStatus,
  },
  {
    id: '4',
    date: '5/12/2568',
    time: '08.44',
    systolic: 67,
    diastolic: 48,
    heartRate: 80,
    status: 'low' as BPStatus,
  },
  {
    id: '5',
    date: '5/12/2568',
    time: '08.44',
    systolic: 190,
    diastolic: 108,
    heartRate: 146,
    status: 'crisis' as BPStatus,
  },
];

export default function HistoryDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedPeriod, setSelectedPeriod] = useState<FilterPeriod>('30วัน');

  const handleBack = () => {
    router.back();
  };

  const handleInfo = () => {
    // TODO: Show info modal
    console.log('Info pressed');
  };

  return (
    <View className="flex-1 bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor={AppColors.primary} />

      {/* Header */}
      <View className="bg-primary pb-4" style={{ paddingTop: insets.top + 10 }}>
        <View className="flex-row justify-between items-center px-4">
          <TouchableOpacity onPress={handleBack} className="p-1">
            <Ionicons name="arrow-back" size={24} color={AppColors.gray700} />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-gray-800">ประวัติความดัน</Text>
          <TouchableOpacity onPress={handleInfo} className="p-1">
            <Ionicons name="information-circle-outline" size={24} color={AppColors.gray700} />
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

      <ScrollView
        className="flex-1 bg-gray-100 rounded-t-3xl"
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Full History List */}
        {fullHistoryData.map((item) => (
          <BPHistoryCard
            key={item.id}
            date={item.date}
            time={item.time}
            systolic={item.systolic}
            diastolic={item.diastolic}
            heartRate={item.heartRate}
            status={item.status}
          />
        ))}
      </ScrollView>
    </View>
  );
}
