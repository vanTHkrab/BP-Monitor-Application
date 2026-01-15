import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
    ScrollView,
    StatusBar,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppColors } from '@/constants/colors';

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
}

function MenuItem({ icon, title, onPress }: MenuItemProps) {
  return (
    <TouchableOpacity
      className="flex-row items-center bg-white rounded-2xl p-4 mb-3 border border-gray-200"
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View className="w-10 h-10 rounded-full bg-primary-light/30 items-center justify-center mr-3.5">
        <Ionicons name={icon} size={24} color={AppColors.primary} />
      </View>
      <Text className="flex-1 text-[15px] font-medium text-gray-700">{title}</Text>
      <Ionicons name="chevron-forward" size={20} color={AppColors.gray400} />
    </TouchableOpacity>
  );
}

export default function MenuScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const handleProfile = () => {
    // TODO: Navigate to profile
    console.log('Profile pressed');
  };

  const handleSettings = () => {
    // TODO: Navigate to settings
    console.log('Settings pressed');
  };

  const handleSecurity = () => {
    // TODO: Navigate to security
    console.log('Security pressed');
  };

  const handleHelp = () => {
    // TODO: Navigate to help
    console.log('Help pressed');
  };

  const handleAbout = () => {
    // TODO: Navigate to about
    console.log('About pressed');
  };

  const handleLogout = () => {
    router.replace('/login');
  };

  return (
    <View className="flex-1 bg-primary">
      <StatusBar barStyle="dark-content" backgroundColor={AppColors.primary} />

      {/* Header */}
      <View className="bg-primary pb-4 items-center" style={{ paddingTop: insets.top + 10 }}>
        <Text className="text-xl font-bold text-gray-800">เมนูอื่นๆ</Text>
      </View>

      <ScrollView
        className="flex-1 bg-gray-100 rounded-t-3xl"
        contentContainerStyle={{ paddingTop: 24, paddingHorizontal: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Menu Items */}
        <MenuItem
          icon="person-outline"
          title="โปรไฟล์ของฉัน"
          onPress={handleProfile}
        />

        <MenuItem
          icon="settings-outline"
          title="ตั้งค่าแอปพลิเคชั่น"
          onPress={handleSettings}
        />

        <MenuItem
          icon="shield-checkmark-outline"
          title="ความปลอดภัย"
          onPress={handleSecurity}
        />

        <MenuItem
          icon="help-circle-outline"
          title="ช่วยเหลือและคำแนะนำ"
          onPress={handleHelp}
        />

        <MenuItem
          icon="information-circle-outline"
          title="เกี่ยวกับ"
          onPress={handleAbout}
        />

        {/* Logout Button */}
        <TouchableOpacity className="bg-primary rounded-full py-4 items-center mt-5" onPress={handleLogout}>
          <Text className="text-base font-semibold text-white">ออกจากระบบ</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
