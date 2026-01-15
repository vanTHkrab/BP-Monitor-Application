import { Text, TouchableOpacity, View } from 'react-native';

type AuthTab = 'login' | 'register';

interface AuthTabsProps {
  selectedTab: AuthTab;
  onSelectTab: (tab: AuthTab) => void;
}

export function AuthTabs({ selectedTab, onSelectTab }: AuthTabsProps) {
  return (
    <View className="flex-row bg-white rounded-[25px] p-1 mb-6">
      <TouchableOpacity
        className={`flex-1 py-2.5 rounded-[20px] items-center ${
          selectedTab === 'login' ? 'bg-primary' : ''
        }`}
        onPress={() => onSelectTab('login')}
      >
        <Text
          className={`text-sm font-semibold ${
            selectedTab === 'login' ? 'text-white' : 'text-gray-500'
          }`}
        >
          เข้าสู่ระบบ
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        className={`flex-1 py-2.5 rounded-[20px] items-center ${
          selectedTab === 'register' ? 'bg-primary' : ''
        }`}
        onPress={() => onSelectTab('register')}
      >
        <Text
          className={`text-sm font-semibold ${
            selectedTab === 'register' ? 'text-white' : 'text-gray-500'
          }`}
        >
          ลงทะเบียน
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export type { AuthTab };
