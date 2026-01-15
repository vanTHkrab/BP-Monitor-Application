import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StatusBar,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthInput } from '@/components/auth/auth-input';
import { AuthTab, AuthTabs } from '@/components/auth/auth-tabs';
import { AppColors } from '@/constants/colors';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<AuthTab>('register');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const handleRegister = () => {
    // TODO: Implement actual registration
    if (password !== confirmPassword) {
      console.log('Passwords do not match');
      return;
    }
    console.log('Register:', { fullName, phone, password });
    router.replace('/(tabs)');
  };

  const handleTabChange = (tab: AuthTab) => {
    setSelectedTab(tab);
    if (tab === 'login') {
      router.push('/login');
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-primary"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="dark-content" backgroundColor={AppColors.primary} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 24,
          paddingTop: insets.top + 40,
          paddingBottom: insets.bottom + 20,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View className="items-center mb-8">
          <Ionicons name="logo-tux" size={80} color={AppColors.gray800} />
          <Text
            className="text-[28px] font-bold text-primary mt-3"
            style={{
              textShadowColor: 'rgba(0, 0, 0, 0.1)',
              textShadowOffset: { width: 1, height: 1 },
              textShadowRadius: 2,
            }}
          >
            ชื่อแอปพลิเคชั่น
          </Text>
        </View>

        {/* Auth Tabs */}
        <AuthTabs selectedTab={selectedTab} onSelectTab={handleTabChange} />

        {/* Register Form */}
        <View className="flex-1">
          <AuthInput
            icon="person-outline"
            placeholder="ชื่อ-นามสกุล"
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
          />

          <AuthInput
            icon="call-outline"
            placeholder="เบอร์โทรศัพท์"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <AuthInput
            icon="lock-closed-outline"
            placeholder="รหัสผ่าน ************"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <AuthInput
            icon="lock-closed-outline"
            placeholder="ยืนยันรหัสผ่าน *******"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />

          {/* Register Button */}
          <TouchableOpacity className="bg-gray-800 rounded-full py-4 items-center mt-3" onPress={handleRegister}>
            <Text className="text-base font-semibold text-white">เข้าสู่ระบบ</Text>
          </TouchableOpacity>
        </View>

        {/* Copyright */}
        <Text className="text-center text-xs text-gray-500 mt-auto pt-10">Copyright©2025 ชื่อแอปพลิเคชั่น</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
