import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { CustomInput } from '@/components/custom-input';
import { GradientBackground } from '@/components/gradient-background';
import { TabButtons } from '@/components/tab-buttons';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

type AuthTab = 'login' | 'register';

export default function AuthScreen() {
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
    } catch (error) {
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
    } catch (error) {
      Alert.alert('ข้อผิดพลาด', 'เกิดข้อผิดพลาดในการลงทะเบียน');
    } finally {
      setIsLoading(false);
    }
  };
  
  const authTabs = [
    { key: 'login', label: 'เข้าสู่ระบบ' },
    { key: 'register', label: 'ลงทะเบียน' },
  ];

  return (
    <GradientBackground>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView 
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            {/* Logo */}
            <ScaleOnMount delay={100}>
              <View style={styles.logoContainer}>
                <LinearGradient
                  colors={['#FFFFFF', '#F0F7FF']}
                  style={styles.logoBackground}
                >
                  <View style={styles.logoInner}>
                    <Ionicons name="heart-circle" size={64} color="#E91E63" />
                    <Ionicons name="pulse" size={32} color="#5DADE2" style={styles.pulseIcon} />
                  </View>
                </LinearGradient>
                <Text style={styles.appName}>BP Monitor</Text>
                <Text style={styles.appTagline}>ติดตามความดันโลหิตอย่างง่ายดาย</Text>
              </View>
            </ScaleOnMount>
            
            {/* Auth Card */}
            <FadeInView delay={200}>
              <View style={styles.authCard}>
                {/* Tabs */}
                <View style={styles.tabContainer}>
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
                    <View style={styles.formContainer}>
                      <CustomInput
                        placeholder="ชื่อ หรือ เบอร์โทรศัพท์"
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
                      
                      <AnimatedPressable onPress={() => {}} style={styles.forgotBtn}>
                        <Text style={styles.forgotText}>ลืมรหัสผ่าน?</Text>
                      </AnimatedPressable>
                      
                      <CustomButton
                        title="เข้าสู่ระบบ"
                        onPress={handleLogin}
                        loading={isLoading}
                        size="large"
                      />

                      {/* Social Login Divider */}

                      {/* Social Login Buttons */}
                      <View style={styles.socialContainer}>
                      </View>
                    </View>
                  </FadeInView>
                )}
                
                {/* Register Form */}
                {activeTab === 'register' && (
                  <FadeInView delay={100}>
                    <View style={styles.formContainer}>
                      <View style={styles.registerAvatarRow}>
                        <AnimatedPressable onPress={pickRegisterAvatar} style={styles.registerAvatarBtn}>
                          <View style={styles.registerAvatarCircle}>
                            {registerAvatarUri ? (
                              <Image source={{ uri: registerAvatarUri }} style={styles.registerAvatarImg} />
                            ) : (
                              <Ionicons name="person" size={32} color="#6B7280" />
                            )}
                          </View>
                          <Text style={styles.registerAvatarLabel}>{registerAvatarUri ? 'เปลี่ยนรูปโปรไฟล์' : 'เพิ่มรูปโปรไฟล์'}</Text>
                        </AnimatedPressable>
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
                      
                      <View style={{ marginTop: 8 }}>
                        <CustomButton
                          title="ลงทะเบียน"
                          onPress={handleRegister}
                          loading={isLoading}
                          size="large"
                          variant="secondary"
                        />
                      </View>

                      <Text style={styles.termsText}>
                        การลงทะเบียนหมายความว่าคุณยอมรับ{' '}
                        <Text style={styles.termsLink}>เงื่อนไขการใช้งาน</Text>
                        {' '}และ{' '}
                        <Text style={styles.termsLink}>นโยบายความเป็นส่วนตัว</Text>
                      </Text>
                    </View>
                  </FadeInView>
                )}
              </View>
            </FadeInView>
          </View>
          
          {/* Footer */}
          <FadeInView delay={400}>
            <View style={styles.footer}>
              <Text style={styles.footerText}>
                Copyright©2025 BP Monitor App
              </Text>
            </View>
          </FadeInView>
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  registerAvatarRow: {
    alignItems: 'center',
    marginBottom: 6,
  },
  registerAvatarBtn: {
    alignItems: 'center',
    gap: 10,
  },
  registerAvatarCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  registerAvatarImg: {
    width: '100%',
    height: '100%',
  },
  registerAvatarLabel: {
    fontSize: 13,
    color: '#2563EB',
    fontWeight: '700',
  },
  logoBackground: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5DADE2',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
    marginBottom: 16,
  },
  logoInner: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pulseIcon: {
    position: 'absolute',
    bottom: -8,
    right: -16,
  },
  appName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2C3E50',
    marginBottom: 4,
  },
  appTagline: {
    fontSize: 14,
    color: '#7F8C8D',
  },
  authCard: {
    backgroundColor: 'white',
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 10,
  },
  tabContainer: {
    marginBottom: 20,
  },
  formContainer: {
    paddingTop: 8,
  },
  forgotBtn: {
    alignSelf: 'flex-end',
    marginBottom: 20,
    marginTop: -8,
  },
  forgotText: {
    color: '#3498DB',
    fontSize: 14,
    fontWeight: '500',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#9CA3AF',
    fontSize: 14,
  },
  socialContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  socialBtn: {
    width: 56,
    height: 56,
    backgroundColor: '#F9FAFB',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  termsText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 12,
    color: '#7F8C8D',
    lineHeight: 18,
  },
  termsLink: {
    color: '#3498DB',
    fontWeight: '500',
  },
  footer: {
    paddingVertical: 24,
  },
  footerText: {
    textAlign: 'center',
    color: '#9CA3AF',
    fontSize: 12,
  },
});
