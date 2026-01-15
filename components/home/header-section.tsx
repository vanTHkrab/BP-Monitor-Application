import { AppColors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { Image, Text, TouchableOpacity, View } from 'react-native';

interface HeaderSectionProps {
  userName: string;
  profileImage?: string;
  onNotificationPress?: () => void;
}

export function HeaderSection({ userName, profileImage, onNotificationPress }: HeaderSectionProps) {
  return (
    <View className="flex-row justify-between items-center px-5 py-4 bg-primary">
      <View className="flex-row items-center">
        {profileImage ? (
          <Image
            source={{ uri: profileImage }}
            className="w-10 h-10 rounded-full mr-3 border-2 border-white"
          />
        ) : (
          <View className="w-10 h-10 rounded-full mr-3 border-2 border-white bg-white items-center justify-center">
            <Ionicons name="person" size={24} color={AppColors.primary} />
          </View>
        )}
        <Text className="text-base font-semibold text-white">สวัสดี, คุณ {userName}</Text>
      </View>
      <TouchableOpacity
        onPress={onNotificationPress}
        className="w-10 h-10 rounded-full bg-white items-center justify-center"
      >
        <Ionicons name="notifications-outline" size={24} color={AppColors.gray700} />
      </TouchableOpacity>
    </View>
  );
}
