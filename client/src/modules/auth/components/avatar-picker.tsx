/**
 * Optional profile photo on the register form.
 *
 * Holds a *local* URI only. The upload happens after registration succeeds
 * (see `useRegister`), because the presign mutations need a session and there
 * is none until the account exists.
 *
 * `Alert` here is deliberate and does not contradict the "inline, not Alert"
 * rule for form errors: this is a one-shot action sheet and a permission
 * prompt, which is exactly what Alert is reserved for.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type AvatarPickerProps = {
  uri: string | null;
  onChange: (uri: string | null) => void;
};

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  // Square, because every surface that renders an avatar crops it to a
  // circle — letting the user pick a wide crop guarantees a bad result.
  aspect: [1, 1],
  quality: 0.8,
};

export function AvatarPicker({ uri, onChange }: AvatarPickerProps) {
  const colors = useTheme();

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('ต้องการสิทธิ์เข้าถึงรูปภาพ', 'กรุณาอนุญาตการเข้าถึงรูปภาพเพื่อเลือกรูปโปรไฟล์');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    if (!result.canceled) onChange(result.assets[0].uri);
  };

  const captureWithCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('ต้องการสิทธิ์ใช้กล้อง', 'กรุณาอนุญาตการใช้กล้องเพื่อถ่ายรูปโปรไฟล์');
      return;
    }
    const result = await ImagePicker.launchCameraAsync(PICKER_OPTIONS);
    if (!result.canceled) onChange(result.assets[0].uri);
  };

  const openOptions = () => {
    Alert.alert('เลือกรูปโปรไฟล์', 'กรุณาเลือกวิธีการ', [
      { text: 'ถ่ายภาพ', onPress: () => void captureWithCamera() },
      { text: 'เลือกรูปจากแกลเลอรี', onPress: () => void pickFromLibrary() },
      ...(uri ? [{ text: 'ลบรูป', style: 'destructive' as const, onPress: () => onChange(null) }] : []),
      { text: 'ยกเลิก', style: 'cancel' as const },
    ]);
  };

  return (
    <View className="mb-6 items-center">
      <Pressable
        onPress={openOptions}
        accessibilityRole="button"
        accessibilityLabel={uri ? 'เปลี่ยนรูปโปรไฟล์' : 'เพิ่มรูปโปรไฟล์'}
        className="h-[100px] w-[100px] items-center justify-center overflow-hidden rounded-full border-2"
        style={{
          borderColor: uri ? colors.primary : colors.border,
          backgroundColor: colors['surface-muted'],
        }}>
        {uri ? (
          <Image source={{ uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <Ionicons name="camera-outline" size={32} color={colors['text-secondary']} />
        )}
      </Pressable>

      <ThemedText type="label" themeColor="text-secondary" className="mt-2">
        {uri ? 'แตะเพื่อเปลี่ยนรูป' : 'เพิ่มรูปโปรไฟล์ (ไม่บังคับ)'}
      </ThemedText>
    </View>
  );
}
