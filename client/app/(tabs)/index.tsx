import { AnimatedPressable, FadeInView, PulseView, ScaleOnMount } from '@/components/animated-components';
import { GradientBackground } from '@/components/gradient-background';
import { Colors, getStatusText, type BPStatus } from '@/constants/colors';
import { formatThaiDate } from '@/data/mockData';
import { useAppStore } from '@/store/useAppStore';
import { getFontClass } from '@/utils/font-scale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import { cssInterop } from 'nativewind';
import React from 'react';
import { Alert, Image, Linking, ScrollView, Text, View } from 'react-native';

cssInterop(LinearGradient, { className: 'style' });

export default function HomeScreen() {
  const { user, readings, fontSizePreference } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const latestReading = readings[0];
  const titleClassName = getFontClass(fontSizePreference, {
    small: 'text-xl',
    medium: 'text-2xl',
    large: 'text-[28px]',
  });
  const sectionBodyClassName = getFontClass(fontSizePreference, {
    small: 'text-[13px]',
    medium: 'text-[15px]',
    large: 'text-[17px]',
  });

  const textPrimaryClassName = isDark ? 'text-slate-200' : 'text-[#2C3E50]';
  const textSecondaryClassName = isDark ? 'text-slate-400' : 'text-[#7F8C8D]';

  const statusUi: Record<BPStatus, { pill: string; dot: string; text: string }> = {
    low: { pill: 'bg-[#3498DB]/20', dot: 'bg-[#3498DB]', text: 'text-[#3498DB]' },
    normal: { pill: 'bg-[#27AE60]/20', dot: 'bg-[#27AE60]', text: 'text-[#27AE60]' },
    elevated: { pill: 'bg-[#F39C12]/20', dot: 'bg-[#F39C12]', text: 'text-[#F39C12]' },
    high: { pill: 'bg-[#E74C3C]/20', dot: 'bg-[#E74C3C]', text: 'text-[#E74C3C]' },
    critical: { pill: 'bg-[#8E44AD]/20', dot: 'bg-[#8E44AD]', text: 'text-[#8E44AD]' },
  };

  const guidanceByStatus: Record<
    BPStatus,
    { title: string; description: string; accent: string; icon: keyof typeof Ionicons.glyphMap }
  > = {
    low: {
      title: 'ค่าความดันค่อนข้างต่ำ',
      description: 'นั่งพัก ดื่มน้ำ และหากมีอาการเวียนหัวหรือหน้ามืดควรแจ้งญาติหรือพบแพทย์',
      accent: '#3498DB',
      icon: 'water-outline',
    },
    normal: {
      title: 'ค่าความดันอยู่ในเกณฑ์ดี',
      description: 'วัดต่อเนื่องตามเวลาประจำและบันทึกผลไว้เพื่อดูแนวโน้ม',
      accent: '#27AE60',
      icon: 'checkmark-circle-outline',
    },
    elevated: {
      title: 'เริ่มสูงกว่าปกติ',
      description: 'พัก 5-10 นาทีแล้ววัดซ้ำ ลดเค็ม และติดตามค่าในช่วงเย็นอีกครั้ง',
      accent: '#F39C12',
      icon: 'alert-circle-outline',
    },
    high: {
      title: 'ความดันค่อนข้างสูง',
      description: 'พักนิ่ง ๆ วัดซ้ำอีกครั้ง หากยังสูงต่อเนื่องควรติดต่อโรงพยาบาลหรือญาติ',
      accent: '#E74C3C',
      icon: 'medkit-outline',
    },
    critical: {
      title: 'เสี่ยงอันตราย ควรพบแพทย์ด่วน',
      description: 'หากมีอาการแน่นหน้าอก ปวดหัวมาก หรือหายใจลำบาก ให้โทรขอความช่วยเหลือทันที',
      accent: '#8E44AD',
      icon: 'warning-outline',
    },
  };

  const latestGuidance = latestReading ? guidanceByStatus[latestReading.status] : null;

  const callEmergency = async () => {
    try {
      await Linking.openURL('tel:1669');
    } catch {
      Alert.alert('ไม่สามารถโทรออกได้', 'กรุณาโทร 1669 จากแอปโทรศัพท์ของเครื่อง');
    }
  };

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
              <Text className={'text-lg font-semibold ' + textPrimaryClassName}>
                สวัสดี, คุณ {user?.firstname || 'ผู้ใช้'}
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
              <Text className={'text-center mb-3 text-sm font-medium ' + textSecondaryClassName}>
                ผลการวัดล่าสุด {latestReading ? formatThaiDate(latestReading.measuredAt) : '-'}
              </Text>
              
              {latestReading ? (
                <>
                  <PulseView active={true}>
                  <View className="flex-row justify-center items-baseline mb-3">
                    <Text className={isDark ? `${getFontClass(fontSizePreference, { small: 'text-[48px]', medium: 'text-[52px]', large: 'text-[60px]' })} font-bold text-slate-100` : `${getFontClass(fontSizePreference, { small: 'text-[48px]', medium: 'text-[52px]', large: 'text-[60px]' })} font-bold text-[#1a1a1a]`}>
                      {latestReading.systolic}
                    </Text>
                      <Text className={isDark ? `${getFontClass(fontSizePreference, { small: 'text-[48px]', medium: 'text-[52px]', large: 'text-[60px]' })} font-bold text-slate-100 mx-1` : `${getFontClass(fontSizePreference, { small: 'text-[48px]', medium: 'text-[52px]', large: 'text-[60px]' })} font-bold text-[#1a1a1a] mx-1`}>
                        /
                      </Text>
                      <Text className={isDark ? `${getFontClass(fontSizePreference, { small: 'text-[48px]', medium: 'text-[52px]', large: 'text-[60px]' })} font-bold text-slate-100` : `${getFontClass(fontSizePreference, { small: 'text-[48px]', medium: 'text-[52px]', large: 'text-[60px]' })} font-bold text-[#1a1a1a]`}>
                        {latestReading.diastolic}
                      </Text>
                      <Text className={getFontClass(fontSizePreference, { small: 'text-lg', medium: 'text-xl', large: 'text-2xl' }) + ' font-semibold ml-2 ' + textSecondaryClassName}>
                        mmHg
                      </Text>
                    </View>
                  </PulseView>
                  
                  <View className="flex-row justify-center items-center">
                    <View className="flex-row items-center bg-[#FDE8E8] px-3 py-1.5 rounded-full">
                      <Ionicons name="heart" size={20} color={Colors.heartRate.icon} />
                      <Text className="text-[#E91E63] ml-1.5 font-semibold">{latestReading.pulse} bpm</Text>
                    </View>
                    <View
                      className={
                        'flex-row items-center px-3 py-1.5 rounded-full ml-4 ' +
                        statusUi[latestReading.status].pill
                      }
                    >
                      <View className={'w-2 h-2 rounded-full mr-1.5 ' + statusUi[latestReading.status].dot} />
                      <Text className={'font-semibold text-sm ' + statusUi[latestReading.status].text}>
                        สถานะ: {getStatusText(latestReading.status)}
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <Text className={'text-center text-base ' + textSecondaryClassName}>
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
              <Text className={`text-white font-semibold ${getFontClass(fontSizePreference, { small: 'text-base', medium: 'text-lg', large: 'text-xl' })}`}>คลิกที่นี่ เพื่อ ถ่ายภาพวัดความดัน</Text>
            </LinearGradient>
          </AnimatedPressable>
        </FadeInView>

        {latestGuidance ? (
          <FadeInView delay={350}>
            <View className="px-4 mt-4">
              <View
                className={
                  (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white border border-[#E5E7EB]') +
                  ' rounded-2xl p-4 shadow-md'
                }
              >
                <View className="flex-row items-start">
                  <View
                    className="w-12 h-12 rounded-full items-center justify-center mr-3"
                    style={{ backgroundColor: `${latestGuidance.accent}22` }}
                  >
                    <Ionicons name={latestGuidance.icon} size={24} color={latestGuidance.accent} />
                  </View>
                  <View className="flex-1">
                    <Text className={getFontClass(fontSizePreference, { small: 'text-base', medium: 'text-lg', large: 'text-xl' }) + ' font-bold ' + textPrimaryClassName}>
                      {latestGuidance.title}
                    </Text>
                    <Text className={`mt-1 leading-6 ${sectionBodyClassName} ` + textSecondaryClassName}>
                      {latestGuidance.description}
                    </Text>
                  </View>
                </View>

                {(latestReading.status === 'high' || latestReading.status === 'critical') && (
                  <View className="flex-row mt-4">
                    <AnimatedPressable onPress={callEmergency} className="flex-1 mr-3">
                      <LinearGradient
                        colors={['#E74C3C', '#C0392B']}
                        className="rounded-2xl py-3.5 items-center justify-center"
                      >
                        <Text className={`text-white font-bold ${getFontClass(fontSizePreference, { small: 'text-base', medium: 'text-lg', large: 'text-xl' })}`}>
                          โทร 1669
                        </Text>
                      </LinearGradient>
                    </AnimatedPressable>
                    <AnimatedPressable onPress={() => router.push('/help' as Href)} className="flex-1">
                      <View className={(isDark ? 'bg-[#111827]' : 'bg-[#EBF5FB]') + ' rounded-2xl py-3.5 items-center justify-center'}>
                        <Text className={`${getFontClass(fontSizePreference, { small: 'text-base', medium: 'text-lg', large: 'text-xl' })} font-semibold ${isDark ? 'text-slate-100' : 'text-[#2C3E50]'}`}>
                          เปิดคำแนะนำ
                        </Text>
                      </View>
                    </AnimatedPressable>
                  </View>
                )}
              </View>
            </View>
          </FadeInView>
        ) : null}

        {/* Trends and Reports Section */}
        <FadeInView delay={400}>
          <View className="px-4 mt-6">
            <Text className={titleClassName + ' font-bold mb-4 ' + textPrimaryClassName}>
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
                    <Text className={sectionBodyClassName + ' mb-1 ' + textSecondaryClassName}>
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
                  <Text className={getFontClass(fontSizePreference, { small: 'text-[11px]', medium: 'text-[13px]', large: 'text-[15px]' }) + ' mb-1 ' + textSecondaryClassName}>
                    สร้างรายงานสุขภาพ
                  </Text>
                  <LinearGradient
                    colors={['#2C3E50', '#1a1a2e']}
                    className="w-[72px] h-[72px] rounded-2xl items-center justify-center mb-2"
                  >
                    <Text className="text-white font-bold text-sm">PDF</Text>
                  </LinearGradient>
                  <Text className={sectionBodyClassName + ' mb-1 ' + textSecondaryClassName}>
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
            <Text className={titleClassName + ' font-bold mb-4 ' + textPrimaryClassName}>
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
                  <Text className={getFontClass(fontSizePreference, { small: 'text-[15px]', medium: 'text-[17px]', large: 'text-[19px]' }) + ' font-semibold ' + textPrimaryClassName}>
                    เคล็ดลับการดูแลสุขภาพ
                  </Text>
                  <Text className={sectionBodyClassName + ' mt-0.5 ' + textSecondaryClassName}>
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
                  <Text className={`text-white font-semibold ${getFontClass(fontSizePreference, { small: 'text-[15px]', medium: 'text-[17px]', large: 'text-[19px]' })}`}>ตั้งการแจ้งเตือน</Text>
                  <Text className={`text-white/80 mt-0.5 ${sectionBodyClassName}`}>เตือนให้วัดความดันเป็นประจำ</Text>
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
