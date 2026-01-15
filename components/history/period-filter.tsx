import { Text, TouchableOpacity, View } from 'react-native';

type FilterPeriod = '7วัน' | '30วัน' | '3เดือน' | '1ปี';

interface PeriodFilterProps {
  selectedPeriod: FilterPeriod;
  onSelectPeriod: (period: FilterPeriod) => void;
}

const periods: FilterPeriod[] = ['7วัน', '30วัน', '3เดือน', '1ปี'];

export function PeriodFilter({ selectedPeriod, onSelectPeriod }: PeriodFilterProps) {
  return (
    <View className="flex-row bg-white rounded-[25px] p-1 mx-5 my-3">
      {periods.map((period) => (
        <TouchableOpacity
          key={period}
          className={`flex-1 py-2 px-3 rounded-[20px] items-center ${
            selectedPeriod === period ? 'bg-primary' : ''
          }`}
          onPress={() => onSelectPeriod(period)}
        >
          <Text
            className={`text-[13px] font-medium ${
              selectedPeriod === period ? 'text-white' : 'text-gray-500'
            }`}
          >
            {period}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export type { FilterPeriod };
