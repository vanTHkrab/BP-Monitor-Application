import { AppColors } from '@/constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { Text, TouchableOpacity, View } from 'react-native';

interface CameraButtonProps {
  onPress: () => void;
}

export function CameraButton({ onPress }: CameraButtonProps) {
  return (
    <TouchableOpacity
      className="flex-row items-center bg-primary rounded-full py-3.5 px-5 mx-5 mt-5 gap-3"
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View className="w-10 h-10 rounded-full bg-white/20 items-center justify-center">
        <Ionicons name="camera" size={24} color={AppColors.white} />
      </View>
      <Text className="text-sm font-semibold text-white flex-1">คลิกที่นี้ เพื่อ ถ่ายภาพวัดความดัน</Text>
    </TouchableOpacity>
  );
}
