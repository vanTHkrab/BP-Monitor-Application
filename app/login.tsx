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

import { Text as TextTest} from '@/components/nativewindui/Text';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState<AuthTab>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = () => {
    // TODO: Implement actual login
    console.log('Login:', { username, password });
    router.replace('/(tabs)');
  };

  const handleForgotPassword = () => {
    // TODO: Navigate to forgot password
    console.log('Forgot password pressed');
  };

  const handleTabChange = (tab: AuthTab) => {
    setSelectedTab(tab);
    if (tab === 'register') {
      router.push('/register');
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
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
          <TextTest
            className="text-xl font-bold  mt-3"
            style={{
              textShadowColor: 'rgba(0, 0, 0, 0.1)',
              textShadowOffset: { width: 1, height: 1 },
              textShadowRadius: 2,
            }}
          >
            ชื่อแอปพลิเคชั่น
          </TextTest>
        </View>

        {/* Auth Tabs */}
        <AuthTabs selectedTab={selectedTab} onSelectTab={handleTabChange} />

        {/* Login Form */}
        <View className="flex-1">
          <AuthInput
            icon="person-outline"
            placeholder="ชื่อ หรือ เบอร์โทรศัพท์"
            value={username}
            onChangeText={setUsername}
          />

          <AuthInput
            icon="lock-closed-outline"
            placeholder="รหัสผ่าน ************"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {/* Forgot Password */}
          <TouchableOpacity
            className="self-end mb-6"
            onPress={handleForgotPassword}
          >
            <Text className="text-[13px] text-primary font-medium">ลืมรหัสผ่าน?</Text>
          </TouchableOpacity>

          {/* Login Button */}
          <TouchableOpacity className="bg-gray-800 rounded-full py-4 items-center" onPress={handleLogin}>
            <Text className="text-base font-semibold text-white">เข้าสู่ระบบ</Text>
          </TouchableOpacity>
        </View>

        {/* Copyright */}
        <Text className="text-center text-xs text-gray-500 mt-auto pt-10">Copyright©2025 ชื่อแอปพลิเคชั่น</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
