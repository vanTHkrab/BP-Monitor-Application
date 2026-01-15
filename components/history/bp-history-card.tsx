import { AppColors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';

type BPStatus = 'normal' | 'elevated' | 'high' | 'crisis' | 'low';

interface BPHistoryCardProps {
  date: string;
  time: string;
  systolic: number;
  diastolic: number;
  heartRate: number;
  status: BPStatus;
  onPress?: () => void;
}

const getStatusConfig = (status: BPStatus) => {
  switch (status) {
    case 'normal':
      return { color: AppColors.bpNormal, icon: 'heart' as const, bgColor: '#DCFCE7' };
    case 'elevated':
      return { color: AppColors.bpHigh, icon: 'heart' as const, bgColor: '#FEF3C7' };
    case 'high':
      return { color: AppColors.bpHigh, icon: 'heart' as const, bgColor: '#FEF3C7' };
    case 'crisis':
      return { color: AppColors.bpDanger, icon: 'heart' as const, bgColor: '#FEE2E2' };
    case 'low':
      return { color: '#3B82F6', icon: 'heart' as const, bgColor: '#DBEAFE' };
    default:
      return { color: AppColors.gray500, icon: 'heart' as const, bgColor: AppColors.gray100 };
  }
};

export function BPHistoryCard({
  date,
  time,
  systolic,
  diastolic,
  heartRate,
  status,
  onPress,
}: BPHistoryCardProps) {
  const statusConfig = getStatusConfig(status);

  return (
    <TouchableOpacity
      className="flex-row justify-between items-center rounded-2xl p-4 mx-5 mb-3"
      style={{ backgroundColor: statusConfig.bgColor }}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View className="flex-1">
        <Text className="text-xs text-gray-500 mb-1">
          {date} เวลา {time}
        </Text>
        <Text className="text-2xl font-bold text-gray-800 mb-1">
          {systolic} / {diastolic}{' '}
          <Text className="text-sm font-normal text-gray-600">mmHg</Text>
        </Text>
        <View className="flex-row items-center gap-1">
          <Ionicons name="heart" size={14} color={AppColors.heartRed} />
          <Text className="text-[13px] text-gray-600">{heartRate} bpm</Text>
        </View>
      </View>

      <View className="items-center">
        <View
          className="w-12 h-12 rounded-full items-center justify-center"
          style={{ backgroundColor: `${statusConfig.color}30` }}
        >
          <Ionicons
            name="fitness"
            size={24}
            color={statusConfig.color}
          />
        </View>
      </View>
    </TouchableOpacity>
  );
}

export type { BPStatus };
