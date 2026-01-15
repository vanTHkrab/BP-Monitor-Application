import { AppColors } from '@/constants/colors';
import { Text, TouchableOpacity, View } from 'react-native';

interface HealthTip {
  id: string;
  title: string;
  color: string;
}

interface HealthTipsSectionProps {
  tips?: HealthTip[];
  onTipPress?: (tipId: string) => void;
}

const defaultTips: HealthTip[] = [
  { id: '1', title: 'เคล็ดลับดูแลความดันโลหิต', color: AppColors.gray200 },
  { id: '2', title: 'อาหารที่ควรทาน', color: AppColors.secondary },
];

export function HealthTipsSection({ tips = defaultTips, onTipPress }: HealthTipsSectionProps) {
  return (
    <View className="mt-6 px-5 mb-[100px]">
      <Text className="text-lg font-bold text-gray-800 mb-4">สุขภาพและการดูแลตัวเอง</Text>
      
      <View className="gap-3">
        {tips.map((tip) => (
          <TouchableOpacity
            key={tip.id}
            className="rounded-2xl p-5 min-h-[60px] justify-center"
            style={{ backgroundColor: tip.color }}
            onPress={() => onTipPress?.(tip.id)}
            activeOpacity={0.7}
          >
            <Text
              className={`text-sm font-semibold ${
                tip.color === AppColors.gray200 ? 'text-gray-700' : 'text-white'
              }`}
            >
              {tip.title}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
