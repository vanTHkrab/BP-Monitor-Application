import { AnimatedPressable, FadeInView, PulseView, ScaleOnMount } from '@/components/animated-components';
import { GradientBackground } from '@/components/gradient-background';
import { Colors, getStatusColor, getStatusText } from '@/constants/colors';
import { formatThaiDate } from '@/data/mockData';
import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import React from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';

cssInterop(LinearGradient, { className: 'style' });

export default function HomeScreen() {
  const { user, readings } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const latestReading = readings[0];

  const textPrimary = isDark ? '#E2E8F0' : '#2C3E50';
  const textSecondary = isDark ? '#94A3B8' : '#7F8C8D';

  return (
    <GradientBackground>
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeInView delay={100}>
          <View className="flex-row justify-between items-center px-4 py-4">
            <View className="flex-row items-center">
              <View
                className={
                  (isDark ? 'bg-[#0F172A]' : 'bg-white') +
                  ' w-[50px] h-[50px] rounded-full overflow-hidden mr-3 shadow-md'
                }
              >
                {user?.avatar ? (
                  <Image source={{ uri: user.avatar }} className="w-full h-full" />
                ) : (
                  <View
                    className={
                      (isDark ? 'bg-[#111827]' : 'bg-[#F0F0F0]') +
                      ' w-full h-full items-center justify-center'
                    }
                  >
                    <Ionicons name="person" size={24} color={Colors.text.secondary} />
                  </View>
                )}
              </View>
              <Text className="text-lg font-semibold" style={{ color: textPrimary }}>
                สวัสดี, คุณ {user?.name || 'ผู้ใช้'}
              </Text>
            </View>
            <AnimatedPressable
              onPress={() => {}}
              className={(isDark ? 'bg-[#0F172A]' : 'bg-white') + ' p-2 rounded-xl shadow-md'}
            >
              <Ionicons name="notifications-outline" size={26} color={isDark ? '#E2E8F0' : Colors.text.primary} />
            </AnimatedPressable>
          </View>
        </FadeInView>

        {/* Latest Reading Card */}
        <ScaleOnMount delay={200}>
          <View className="mx-4 rounded-3xl overflow-hidden shadow-lg">
            <LinearGradient
              colors={isDark ? ['#0F172A', '#111827'] : ['#FFFFFF', '#F8FAFC']}
              className="p-5 rounded-3xl"
            >
              <Text className="text-center mb-3 text-sm font-medium" style={{ color: textSecondary }}>
                ผลการวัดล่าสุด {latestReading ? formatThaiDate(latestReading.measuredAt) : '-'}
              </Text>
              
              {latestReading ? (
                <>
                  <PulseView active={true}>
                    <View className="flex-row justify-center items-baseline mb-3">
                      <Text className={isDark ? 'text-[52px] font-bold text-slate-100' : 'text-[52px] font-bold text-[#1a1a1a]'}>
                        {latestReading.systolic}
                      </Text>
                      <Text className={isDark ? 'text-[52px] font-bold text-slate-100 mx-1' : 'text-[52px] font-bold text-[#1a1a1a] mx-1'}>
                        /
                      </Text>
                      <Text className={isDark ? 'text-[52px] font-bold text-slate-100' : 'text-[52px] font-bold text-[#1a1a1a]'}>
                        {latestReading.diastolic}
                      </Text>
                      <Text className="text-lg font-semibold ml-2" style={{ color: textSecondary }}>
                        mmHg
                      </Text>
                    </View>
                  </PulseView>
                  
                  <View className="flex-row justify-center items-center">
                    <View className="flex-row items-center bg-[#FDE8E8] px-3 py-1.5 rounded-full">
                      <Ionicons name="heart" size={20} color={Colors.heartRate.icon} />
                      <Text className="text-[#E91E63] ml-1.5 font-semibold">{latestReading.pulse} bpm</Text>
                    </View>
                    <View className="flex-row items-center px-3 py-1.5 rounded-full ml-4" style={{ backgroundColor: getStatusColor(latestReading.status) + '20' }}>
                      <View className="w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: getStatusColor(latestReading.status) }} />
                      <Text className="font-semibold text-sm" style={{ color: getStatusColor(latestReading.status) }}>
                        สถานะ: {getStatusText(latestReading.status)}
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <Text className="text-center text-base" style={{ color: textSecondary }}>
                  ยังไม่มีข้อมูล
                </Text>
              )}
            </LinearGradient>
          </View>
        </ScaleOnMount>

        {/* Camera Button */}
        <FadeInView delay={300}>
          <AnimatedPressable 
            onPress={() => router.push('/(tabs)/camera' as Href)}
            className="mx-4 mt-4"
          >
            <LinearGradient
              colors={['#5DADE2', '#3498DB', '#2980B9']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              className="flex-row items-center justify-center py-4 rounded-2xl shadow-lg"
            >
              <View className={(isDark ? 'bg-[#0F172A]' : 'bg-white') + ' w-11 h-11 rounded-xl items-center justify-center mr-3'}>
                <Ionicons name="camera" size={26} color="#3498DB" />
              </View>
              <Text className="text-white text-base font-semibold">คลิกที่นี่ เพื่อ ถ่ายภาพวัดความดัน</Text>
            </LinearGradient>
          </AnimatedPressable>
        </FadeInView>

        {/* Trends and Reports Section */}
        <FadeInView delay={400}>
          <View className="px-4 mt-6">
            <Text className="text-xl font-bold mb-4" style={{ color: textPrimary }}>
              แนวโน้มและรายงาน
            </Text>
            
            <View className="flex-row justify-center">
              {/* View History */}
              <AnimatedPressable
                onPress={() => router.push('/(tabs)/history' as Href)}
                className="flex-1"
              >
                <View
                  className={
                    (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white') +
                    ' rounded-2xl p-[18px] min-h-[170px] items-center shadow-md'
                  }
                >
                  <View className="w-[72px] h-[72px] bg-[#EBF5FB] rounded-2xl items-center justify-center mb-2">
                    <Ionicons name="trending-up" size={32} color="#5DADE2" />
                  </View>
                  <View className="flex-row items-center justify-center mt-0.5">
                    <Text className="text-[13px] mb-1" style={{ color: textSecondary }}>
                      ดูประวัติทั้งหมด
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={isDark ? '#94A3B8' : Colors.text.secondary}
                    />
                  </View>
                </View>
              </AnimatedPressable>
              
              {/* Generate Report */}
              <AnimatedPressable
                onPress={() => {}}
                className="flex-1 ml-4"
              >
                <View
                  className={
                    (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white') +
                    ' rounded-2xl p-[18px] min-h-[170px] items-center shadow-md'
                  }
                >
                  <Text className="text-[11px] mb-1" style={{ color: textSecondary }}>
                    สร้างรายงานสุขภาพ
                  </Text>
                  <LinearGradient
                    colors={['#2C3E50', '#1a1a2e']}
                    className="w-[72px] h-[72px] rounded-2xl items-center justify-center mb-2"
                  >
                    <Text className="text-white font-bold text-sm">PDF</Text>
                  </LinearGradient>
                  <Text className="text-[13px] mb-1" style={{ color: textSecondary }}>
                    กดเพื่อสร้าง
                  </Text>
                </View>
              </AnimatedPressable>
            </View>
          </View>
        </FadeInView>

        {/* Health Tips Section */}
        <FadeInView delay={500}>
          <View className="px-4 mt-6">
            <Text className="text-xl font-bold mb-4" style={{ color: textPrimary }}>
              สุขภาพและการดูแลตัวเอง
            </Text>
            
            <AnimatedPressable onPress={() => {}} className="mb-3">
              <View
                className={
                  (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white') +
                  ' rounded-2xl p-4 flex-row items-center shadow-md'
                }
              >
                <View className="w-11 h-11 bg-[#E8F5E9] rounded-full items-center justify-center mr-3">
                  <Ionicons name="leaf" size={22} color="#27AE60" />
                </View>
                <View className="flex-1">
                  <Text className="font-semibold text-[15px]" style={{ color: textPrimary }}>
                    เคล็ดลับการดูแลสุขภาพ
                  </Text>
                  <Text className="text-[13px] mt-0.5" style={{ color: textSecondary }}>
                    อ่านบทความเกี่ยวกับการดูแลความดันโลหิต
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={Colors.text.secondary} />
              </View>
            </AnimatedPressable>
            
            <AnimatedPressable onPress={() => {}}>
              <LinearGradient
                colors={['#9B59B6', '#8E44AD', '#6C3483']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                className="rounded-2xl p-4 flex-row items-center shadow-lg"
              >
                <View className="w-11 h-11 bg-white/20 rounded-full items-center justify-center mr-3">
                  <Ionicons name="calendar" size={22} color="white" />
                </View>
                <View className="flex-1">
                  <Text className="text-white font-semibold text-[15px]">ตั้งการแจ้งเตือน</Text>
                  <Text className="text-white/80 text-[13px] mt-0.5">เตือนให้วัดความดันเป็นประจำ</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="white" />
              </LinearGradient>
            </AnimatedPressable>
          </View>
        </FadeInView>

        <View className="h-[100px]" />
      </ScrollView>
    </GradientBackground>
  );
}
