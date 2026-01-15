import { Text, TouchableOpacity, View } from 'react-native';

type TabType = 'พูดคุยทั่วไป' | 'แชร์ประสบการณ์' | 'Q&A';

interface CommunityTabsProps {
  selectedTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

const tabs: TabType[] = ['พูดคุยทั่วไป', 'แชร์ประสบการณ์', 'Q&A'];

export function CommunityTabs({ selectedTab, onSelectTab }: CommunityTabsProps) {
  return (
    <View className="flex-row px-5 py-3 gap-2">
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab}
          className={`py-2 px-3.5 rounded-full bg-white border border-gray-200 ${
            selectedTab === tab ? 'bg-primary border-primary' : ''
          }`}
          onPress={() => onSelectTab(tab)}
        >
          <Text
            className={`text-xs font-medium ${
              selectedTab === tab ? 'text-white' : 'text-gray-600'
            }`}
          >
            {tab}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export type { TabType };
