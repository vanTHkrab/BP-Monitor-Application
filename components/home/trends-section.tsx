import { AppColors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';

interface TrendsSectionProps {
  onViewHistory: () => void;
  onGenerateReport: () => void;
}

export function TrendsSection({ onViewHistory, onGenerateReport }: TrendsSectionProps) {
  return (
    <View className="mt-6 px-5">
      <Text className="text-lg font-bold text-gray-800 mb-4">แนวโน้มและรายงาน</Text>
      
      <View className="flex-row gap-3">
        {/* History Card */}
        <TouchableOpacity
          className="flex-1 bg-white rounded-2xl p-4 border border-gray-200 min-h-[120px] justify-between shadow-sm"
          onPress={onViewHistory}
          activeOpacity={0.7}
        >
          <View className="items-start mb-2">
            <Ionicons name="trending-up" size={32} color={AppColors.gray600} />
          </View>
          <Text className="text-[13px] text-gray-600 font-medium">ดูประวัติทั้งหมด {'>'}</Text>
        </TouchableOpacity>
        
        {/* PDF Report Card */}
        <TouchableOpacity
          className="flex-1 bg-white rounded-2xl p-4 border border-gray-200 min-h-[120px] justify-between shadow-sm"
          onPress={onGenerateReport}
          activeOpacity={0.7}
        >
          <View className="bg-gray-800 rounded-lg px-2 py-1 self-start">
            <Text className="text-white text-[10px] font-semibold">สร้างรายงานสุขภาพ</Text>
          </View>
          <View className="items-center my-2">
            <View className="w-10 h-12 bg-gray-800 rounded justify-center items-center">
              <Text className="text-white text-xs font-bold">PDF</Text>
            </View>
          </View>
          <Text className="text-xs text-gray-500 text-center">กดเพื่อสร้าง</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
