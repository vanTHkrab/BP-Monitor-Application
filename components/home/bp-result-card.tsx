import { AppColors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

interface BPResultCardProps {
  systolic: number;
  diastolic: number;
  heartRate: number;
  status: 'ปกติ' | 'สูง' | 'ต่ำ' | 'อันตราย';
  lastMeasuredDate: string;
  lastMeasuredTime: string;
}

const getStatusClasses = (status: string) => {
  switch (status) {
    case 'ปกติ':
      return { text: 'text-emerald-500', bg: 'bg-emerald-500/20' };
    case 'สูง':
      return { text: 'text-amber-500', bg: 'bg-amber-500/20' };
    case 'อันตราย':
      return { text: 'text-red-500', bg: 'bg-red-500/20' };
    default:
      return { text: 'text-gray-500', bg: 'bg-gray-500/20' };
  }
};

export function BPResultCard({
  systolic,
  diastolic,
  heartRate,
  status,
  lastMeasuredDate,
  lastMeasuredTime,
}: BPResultCardProps) {
  const statusClasses = getStatusClasses(status);

  return (
    <View className="bg-white rounded-2xl p-5 mx-5 -mt-5 shadow-md">
      <Text className="text-xs text-gray-500 text-center mb-2">
        ผลการวัดล่าสุด {lastMeasuredDate} เวลา {lastMeasuredTime}
      </Text>
      
      <View className="items-center my-2">
        <Text className="text-4xl font-bold text-gray-800">
          {systolic} / {diastolic} <Text className="text-xl font-normal text-gray-600">mmHg</Text>
        </Text>
      </View>
      
      <View className="flex-row justify-between items-center mt-3">
        <View className="flex-row items-center gap-[6px]">
          <Ionicons name="heart" size={18} color={AppColors.heartRed} />
          <Text className="text-sm text-gray-700 font-medium">{heartRate} bpm</Text>
        </View>
        
        <View className={`px-3 py-1.5 rounded-xl ${statusClasses.bg}`}>
          <Text className={`text-sm font-semibold ${statusClasses.text}`}>
            สถานะ: {status}
          </Text>
        </View>
      </View>
    </View>
  );
}
