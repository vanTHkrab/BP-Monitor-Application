import { AnimatedPressable, FadeInView, ScaleOnMount } from '@/components/animated-components';
import { CustomButton } from '@/components/custom-button';
import { GradientBackground } from '@/components/gradient-background';
import { MenuItem } from '@/components/menu-item';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import { cssInterop } from 'nativewind';
import React from 'react';
import { Alert, Image, ScrollView, Text, View } from 'react-native';

cssInterop(LinearGradient, { className: 'style' });

export default function MenuScreen() {
  const { logout, user } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';

  const handleLogout = () => {
    Alert.alert(
      'ออกจากระบบ',
      'คุณต้องการออกจากระบบหรือไม่?',
      [
        { text: 'ยกเลิก', style: 'cancel' },
        {
          text: 'ออกจากระบบ',
          style: 'destructive',
          onPress: () => {
            logout();
            router.replace('/auth' as Href);
          },
        },
      ]
    );
  };

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeInView delay={100}>
          <View className="items-center py-4">
            <LinearGradient
              colors={['#5DADE2', '#3498DB']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              className="flex-row items-center px-6 py-2.5 rounded-xl shadow-lg"
            >
              <View className="mr-2">
                <Ionicons name="menu" size={20} color="white" />
              </View>
              <Text className="text-lg font-bold text-white">เมนูอื่นๆ</Text>
            </LinearGradient>
          </View>
        </FadeInView>

        {/* User Profile Card */}
        <ScaleOnMount delay={200}>
          <AnimatedPressable 
            onPress={() => router.push('/profile' as Href)}
            className="mx-4 mt-2 rounded-2xl overflow-hidden shadow-lg"
          >
            <LinearGradient
              colors={isDark ? ['#0F172A', '#111827'] : ['#FFFFFF', '#F8FAFC']}
              className="flex-row items-center p-4"
            >
              <View className="w-[60px] h-[60px] rounded-full overflow-hidden mr-3.5">
                {user?.avatar ? (
                  <Image source={{ uri: user.avatar }} className="w-full h-full" />
                ) : (
                  <LinearGradient
                    colors={['#5DADE2', '#3498DB']}
                    className="w-full h-full items-center justify-center"
                  >
                    <Ionicons name="person" size={32} color="white" />
                  </LinearGradient>
                )}
              </View>
              <View className="flex-1">
                <Text className={isDark ? 'text-lg font-bold text-slate-200 mb-1' : 'text-lg font-bold text-[#2C3E50] mb-1'}>
                  {user?.name || 'ผู้ใช้'}
                </Text>
                <Text className={isDark ? 'text-sm text-slate-400' : 'text-sm text-[#7F8C8D]'}>
                  {user?.email || 'user@example.com'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color={isDark ? '#94A3B8' : '#9CA3AF'} />
            </LinearGradient>
          </AnimatedPressable>
        </ScaleOnMount>

        {/* Menu Items */}
        <View className="px-4 mt-5">
          <FadeInView delay={300}>
            <Text className={(isDark ? 'text-slate-400' : 'text-[#7F8C8D]') + ' text-sm font-semibold mb-3 ml-1 uppercase tracking-[0.5px]'}>
              บัญชีและการตั้งค่า
            </Text>
            <MenuItem
              icon="person-outline"
              title="โปรไฟล์ของฉัน"
              onPress={() => router.push('/profile' as Href)}
            />
            
            <MenuItem
              icon="settings-outline"
              title="ตั้งค่าแอปพลิเคชั่น"
              onPress={() => router.push('/settings' as Href)}
            />
            
            <MenuItem
              icon="shield-checkmark-outline"
              title="ความปลอดภัย"
              onPress={() => router.push('/security' as Href)}
            />
          </FadeInView>

          <FadeInView delay={400}>
            <Text className={(isDark ? 'text-slate-400' : 'text-[#7F8C8D]') + ' text-sm font-semibold mb-3 ml-1 uppercase tracking-[0.5px] mt-6'}>
              ความช่วยเหลือ
            </Text>
            <MenuItem
              icon="help-circle-outline"
              title="ช่วยเหลือและคำแนะนำ"
              onPress={() => router.push('/help' as Href)}
            />
            
            <MenuItem
              icon="information-circle-outline"
              title="เกี่ยวกับ"
              onPress={() => router.push('/about' as Href)}
            />
          </FadeInView>
        </View>

        {/* Logout Button */}
        <FadeInView delay={500}>
          <View className="px-4 mt-6">
            <CustomButton
              title="ออกจากระบบ"
              onPress={handleLogout}
              variant="danger"
            />
          </View>
        </FadeInView>

        {/* App Version */}
        <FadeInView delay={600}>
          <View className="items-center py-6 pb-[100px]">
            <Text className={isDark ? 'text-xs text-slate-400' : 'text-xs text-gray-400'}>BP Monitor v1.0.0</Text>
          </View>
        </FadeInView>
      </ScrollView>
    </GradientBackground>
  );
}
