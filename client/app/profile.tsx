import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { GradientBackground } from '@/components/gradient-background';
import { Colors } from '@/constants/colors';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function ProfileScreen() {
  const { user, updateMyProfile, uploadMyAvatar } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const headerIconColor = themePreference === 'dark' ? '#E2E8F0' : Colors.text.primary;
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [avatar, setAvatar] = useState(user?.avatar || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('ต้องการสิทธิ์', 'กรุณาอนุญาตการเข้าถึงรูปภาพเพื่อเลือกรูปโปรไฟล์');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatar(result.assets[0].uri);
    }
  };

  const captureImage = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('ต้องการสิทธิ์', 'กรุณาอนุญาตการเข้าถึงกล้องเพื่อถ่ายรูปโปรไฟล์');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setAvatar(result.assets[0].uri);
    }
  };

  const openAvatarOptions = () => {
    Alert.alert('เลือกรูปโปรไฟล์', 'กรุณาเลือกวิธีการ', [
      { text: 'ถ่ายภาพ', onPress: () => void captureImage() },
      { text: 'เลือกรูปจากแกลเลอรี', onPress: () => void pickImage() },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };

  const handleSave = async () => {
    if (!user) {
      Alert.alert('กรุณาเข้าสู่ระบบ', 'ต้องเข้าสู่ระบบก่อนแก้ไขโปรไฟล์');
      return;
    }

    setIsSaving(true);
    try {
      const okInfo = await updateMyProfile({ name, phone });
      if (!okInfo) {
        Alert.alert('ข้อผิดพลาด', 'ไม่สามารถบันทึกข้อมูลโปรไฟล์ได้');
        return;
      }

      // If avatar is a local file uri, upload it. If it's already a URL, skip.
      if (avatar && !/^https?:\/\//i.test(avatar)) {
        const okAvatar = await uploadMyAvatar(avatar);
        if (!okAvatar) {
          const { authErrorCode, authErrorMessage, authErrorRawMessage } = useAppStore.getState();
          const detail = [
            authErrorMessage || 'บันทึกข้อมูลได้ แต่ไม่สามารถอัปโหลดรูปโปรไฟล์ได้',
            authErrorCode ? `(${authErrorCode})` : null,
            authErrorRawMessage ? authErrorRawMessage : null,
          ]
            .filter(Boolean)
            .join('\n');
          Alert.alert('ข้อผิดพลาด', detail);
          setIsEditing(false);
          return;
        }
      }

      Alert.alert('สำเร็จ', 'บันทึกข้อมูลเรียบร้อย');
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View className="relative flex-row items-center justify-center px-4 py-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="absolute left-4 p-1"
          >
            <Ionicons name="arrow-back" size={28} color={headerIconColor} />
          </TouchableOpacity>

          <Text className="text-xl font-bold text-gray-800 dark:text-slate-100 text-center">โปรไฟล์ของฉัน</Text>

          <TouchableOpacity
            onPress={() => setIsEditing(!isEditing)}
            className="absolute right-4 p-1"
          >
            <Text className="text-blue-500 font-medium">{isEditing ? 'ยกเลิก' : 'แก้ไข'}</Text>
          </TouchableOpacity>
        </View>

        {/* Avatar */}
        <View className="items-center py-6">
          <TouchableOpacity onPress={isEditing ? openAvatarOptions : undefined} activeOpacity={isEditing ? 0.7 : 1}>
            <View className="w-28 h-28 rounded-full bg-white dark:bg-slate-900 overflow-hidden border-4 border-white dark:border-slate-700 shadow-lg">
              {avatar ? (
                <Image source={{ uri: avatar }} className="w-full h-full" />
              ) : (
                <View className="w-full h-full items-center justify-center bg-gray-200 dark:bg-slate-800">
                  <Ionicons name="person" size={48} color={Colors.text.secondary} />
                </View>
              )}
            </View>
            {isEditing && (
              <View className="absolute bottom-0 right-0 w-8 h-8 bg-blue-500 rounded-full items-center justify-center">
                <Ionicons name="camera" size={16} color="white" />
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Form */}
        <View className="px-4">
          <CustomInput
            placeholder="ชื่อ-นามสกุล"
            value={name}
            onChangeText={setName}
            icon="person-outline"
            editable={isEditing}
          />
          
          <CustomInput
            placeholder="เบอร์โทรศัพท์"
            value={phone}
            onChangeText={setPhone}
            icon="call-outline"
            keyboardType="phone-pad"
            editable={isEditing}
          />

          {isEditing && (
            <View className="mt-4">
              <CustomButton
                title="บันทึก"
                onPress={handleSave}
                loading={isSaving}
              />
            </View>
          )}
        </View>

        {/* Stats */}
        <View className="px-4 mt-8">
          <Text className="text-lg font-bold text-gray-800 dark:text-slate-100 mb-4">สถิติของคุณ</Text>
          <View className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-transparent dark:border-slate-700">
            <View className="flex-row justify-between py-2 border-b border-gray-100 dark:border-slate-700">
              <Text className="text-gray-600 dark:text-slate-300">จำนวนการวัดทั้งหมด</Text>
              <Text className="font-bold text-gray-800 dark:text-slate-100">156 ครั้ง</Text>
            </View>
            <View className="flex-row justify-between py-2 border-b border-gray-100 dark:border-slate-700">
              <Text className="text-gray-600 dark:text-slate-300">วันที่เริ่มใช้งาน</Text>
              <Text className="font-bold text-gray-800 dark:text-slate-100">15 ม.ค. 2567</Text>
            </View>
            <View className="flex-row justify-between py-2">
              <Text className="text-gray-600 dark:text-slate-300">ค่าเฉลี่ยความดัน</Text>
              <Text className="font-bold text-gray-800 dark:text-slate-100">118/76 mmHg</Text>
            </View>
          </View>
        </View>

        <View className="h-8" />
      </ScrollView>
    </GradientBackground>
  );
}
