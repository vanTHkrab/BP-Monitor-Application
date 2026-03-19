import { FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import { cssInterop } from 'nativewind';
import React, { useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

type AuthTab = 'login' | 'register';

cssInterop(LinearGradient, { className: 'style' });

export default function AuthScreen() {
  const DEV_BUILD_ID = 'auth-layout-2026-01-22-1';
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [isLoading, setIsLoading] = useState(false);
  
  // Login form
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  
  // Register form
  const [registerName, setRegisterName] = useState('');
  const [registerPhone, setRegisterPhone] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registerAvatarUri, setRegisterAvatarUri] = useState<string | null>(null);
  
  const { login, register, clearAuthError } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';

  const pickRegisterAvatar = async () => {
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
      setRegisterAvatarUri(result.assets[0].uri);
    }
  };

  const captureRegisterAvatar = async () => {
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
      setRegisterAvatarUri(result.assets[0].uri);
    }
  };

  const openRegisterAvatarOptions = () => {
    Alert.alert('เลือกรูปโปรไฟล์', 'กรุณาเลือกวิธีการ', [
      { text: 'ถ่ายภาพ', onPress: () => void captureRegisterAvatar() },
      { text: 'เลือกรูปจากแกลเลอรี', onPress: () => void pickRegisterAvatar() },
      { text: 'ยกเลิก', style: 'cancel' },
    ]);
  };
  
  const handleLogin = async () => {
    if (!loginPhone || !loginPassword) {
      Alert.alert('ข้อผิดพลาด', 'กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    
    setIsLoading(true);
    try {
      clearAuthError();
      const success = await login(loginPhone, loginPassword);
      if (success) {
        router.replace('/(tabs)' as Href);
      } else {
        const { authErrorCode, authErrorMessage, authErrorRawMessage } = useAppStore.getState();
        const detail = [
          authErrorMessage || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
          authErrorCode ? `(${authErrorCode})` : null,
          authErrorRawMessage ? authErrorRawMessage : null,
        ]
          .filter(Boolean)
          .join('\n');
        Alert.alert('ข้อผิดพลาด', detail);
      }
    } catch {
      Alert.alert('ข้อผิดพลาด', 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleRegister = async () => {
    if (!registerName || !registerPhone || !registerPassword || !confirmPassword) {
      Alert.alert('ข้อผิดพลาด', 'กรุณากรอกข้อมูลให้ครบถ้วน');
      return;
    }
    
    if (registerPassword !== confirmPassword) {
      Alert.alert('ข้อผิดพลาด', 'รหัสผ่านไม่ตรงกัน');
      return;
    }
    
    if (registerPassword.length < 6) {
      Alert.alert('ข้อผิดพลาด', 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
      return;
    }
    
    setIsLoading(true);
    try {
      clearAuthError();
      const success = await register(registerName, registerPhone, registerPassword, registerAvatarUri);
      if (success) {
        const { authErrorCode, authErrorMessage, authErrorRawMessage } = useAppStore.getState();
        if (authErrorCode || authErrorMessage || authErrorRawMessage) {
          const detail = [
            'ลงทะเบียนสำเร็จแล้ว แต่การอัปโหลดรูปโปรไฟล์ไม่สำเร็จ',
            authErrorMessage ? authErrorMessage : null,
            authErrorCode ? `(${authErrorCode})` : null,
            authErrorRawMessage ? authErrorRawMessage : null,
          ]
            .filter(Boolean)
            .join('\n');
          Alert.alert('แจ้งเตือน', detail);
        }
        setRegisterAvatarUri(null);
        router.replace('/(tabs)' as Href);
      } else {
        const { authErrorCode, authErrorMessage, authErrorRawMessage } = useAppStore.getState();
        const detail = [
          authErrorMessage || 'ไม่สามารถลงทะเบียนได้',
          authErrorCode ? `(${authErrorCode})` : null,
          authErrorRawMessage ? authErrorRawMessage : null,
        ]
          .filter(Boolean)
          .join('\n');
        Alert.alert('ข้อผิดพลาด', detail);
      }
    } catch {
      Alert.alert('ข้อผิดพลาด', 'เกิดข้อผิดพลาดในการลงทะเบียน');
    } finally {
      setIsLoading(false);
    }
  };
  
  const authTabs = [
    { key: 'login', label: 'เข้าสู่ระบบ' },
    { key: 'register', label: 'ลงทะเบียน' },
  ];

  const authCardClassName =
    'rounded-3xl p-6 border shadow-xl ' +
    (isDark ? 'bg-[#1E293B] border-[#334155] shadow-black/40' : 'bg-white border-[#E2E8F0] shadow-black/10');

  const avatarBoxClassName =
    'w-[90px] h-[90px] rounded-full overflow-hidden items-center justify-center border-4 shadow-md ' +
    (isDark ? 'bg-[#0F172A] border-[#334155] shadow-black/40' : 'bg-[#F9FAFB] border-[#E2E8F0] shadow-black/10');

  return (
    <GradientBackground>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView 
          className="flex-1"
          contentContainerClassName="flex-grow"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="flex-1 px-6 pt-6">
            {/* Logo */}
            <ScaleOnMount delay={100}>
              <View className="items-center mb-8">
                <LinearGradient
                  colors={isDark ? ['#1E293B', '#0F172A'] : ['#FFFFFF', '#F0F7FF']}
                  className={
                    'w-[120px] h-[120px] rounded-full items-center justify-center mb-4 shadow-xl ' +
                    (isDark ? 'shadow-[#5DADE2]/30' : 'shadow-black/15')
                  }
                >
                  <View className="items-center justify-center relative">
                    <Ionicons name="heart-circle" size={64} color="#E91E63" />
                    <View className="absolute -bottom-2 -right-4">
                      <Ionicons name="pulse" size={32} color="#5DADE2" />
                    </View>
                  </View>
                </LinearGradient>
                <Text className={isDark ? 'text-[28px] font-bold text-white mb-1' : 'text-[28px] font-bold text-[#2C3E50] mb-1'}>
                  BP Monitor
                </Text>
                <Text className={isDark ? 'text-sm text-slate-300' : 'text-sm text-[#7F8C8D]'}>
                  ติดตามความดันโลหิตอย่างง่ายดาย
                </Text>
              </View>
            </ScaleOnMount>
            
            {/* Auth Card */}
            <FadeInView delay={200}>
              <View className={authCardClassName}>
                {/* Tabs */}
                <View className="mb-6">
                  <TabButtons
                    tabs={authTabs}
                    activeTab={activeTab}
                    onTabChange={(key) => setActiveTab(key as AuthTab)}
                    variant="default"
                  />
                </View>
                
                {/* Login Form */}
                {activeTab === 'login' && (
                  <FadeInView delay={100}>
                    <View className="pt-2">
                      <CustomInput
                        placeholder="เบอร์โทรศัพท์"
                        value={loginPhone}
                        onChangeText={setLoginPhone}
                        icon="person-outline"
                        keyboardType="phone-pad"
                      />
                      
                      <CustomInput
                        placeholder="รหัสผ่าน"
                        value={loginPassword}
                        onChangeText={setLoginPassword}
                        icon="lock-closed-outline"
                        secureTextEntry
                      />
                      
                      {/* <Pressable onPress={() => {}} className="self-end mb-5 -mt-2">
                        <Text className="text-[#3498DB] text-sm font-semibold">ลืมรหัสผ่าน?</Text>
                      </Pressable> */}
                      
                      <CustomButton
                        title="เข้าสู่ระบบ"
                        onPress={handleLogin}
                        loading={isLoading}
                        size="large"
                      />
                    </View>
                  </FadeInView>
                )}
                
                {/* Register Form */}
                {activeTab === 'register' && (
                  <FadeInView delay={100}>
                    <View className="pt-2">
                      <View className="items-center mb-4">
                        <Pressable onPress={openRegisterAvatarOptions} className="items-center">
                          <View className={avatarBoxClassName}>
                            {registerAvatarUri ? (
                              <Image source={{ uri: registerAvatarUri }} className="w-full h-full" />
                            ) : (
                              <Ionicons name="person" size={40} color={isDark ? '#64748B' : '#94A3B8'} />
                            )}
                          </View>
                          <Text className="text-[13px] text-[#3498DB] font-bold mt-3">
                            {registerAvatarUri ? 'เปลี่ยนรูปโปรไฟล์' : 'เพิ่มรูปโปรไฟล์'}
                          </Text>
                        </Pressable>
                      </View>

                      <CustomInput
                        placeholder="ชื่อ-นามสกุล"
                        value={registerName}
                        onChangeText={setRegisterName}
                        icon="person-outline"
                      />
                      
                      <CustomInput
                        placeholder="เบอร์โทรศัพท์"
                        value={registerPhone}
                        onChangeText={setRegisterPhone}
                        icon="call-outline"
                        keyboardType="phone-pad"
                      />
                      
                      <CustomInput
                        placeholder="รหัสผ่าน"
                        value={registerPassword}
                        onChangeText={setRegisterPassword}
                        icon="lock-closed-outline"
                        secureTextEntry
                      />
                      
                      <CustomInput
                        placeholder="ยืนยันรหัสผ่าน"
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        icon="lock-closed-outline"
                        secureTextEntry
                      />
                      
                      <View className="mt-2">
                        <CustomButton
                          title="ลงทะเบียน"
                          onPress={handleRegister}
                          loading={isLoading}
                          size="large"
                          variant="secondary"
                        />
                      </View>

                      <Text
                        className={
                          isDark
                            ? 'text-center mt-5 text-xs text-slate-300 leading-[18px]'
                            : 'text-center mt-5 text-xs text-[#64748B] leading-[18px]'
                        }
                      >
                        การลงทะเบียนหมายความว่าคุณยอมรับ{' '}
                        <Text className="text-[#3498DB] font-semibold">เงื่อนไขการใช้งาน</Text>
                        {' '}และ{' '}
                        <Text className="text-[#3498DB] font-semibold">นโยบายความเป็นส่วนตัว</Text>
                      </Text>
                    </View>
                  </FadeInView>
                )}
              </View>
            </FadeInView>
          </View>
          
          {/* Footer */}
          <FadeInView delay={400}>
            <View className="py-6">
              <Text className={isDark ? 'text-center text-white text-xs' : 'text-center text-white text-xs'}>
                Copyright©2025 BP Monitor App
              </Text>
            </View>
          </FadeInView>
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBackground>
  );
}