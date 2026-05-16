import { AnimatedPressable, FadeInView, PulseView, ScaleOnMount } from '@/components/animated-components';
import { GradientBackground } from '@/components/gradient-background';
import { Avatar } from '@/components/ui/avatar';
import { Colors, getStatusText, type BPStatus } from '@/constants/colors';
import { formatThaiDate } from '@/data/mockData';
import { useAppStore } from '@/store/use-app-store';
import { shareReadingsExport } from '@/utils/export-data';
import { getFontClass, getFontNumber } from '@/utils/font-scale';
import { toDisplayImageUri } from '@/utils/storage-image';
import {
  getInAppNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type InAppNotificationItem,
} from '@/utils/app-notifications';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import { cssInterop } from 'nativewind';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Modal, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });

export default function HomeScreen() {
  const {
    user,
    readings,
    fontSizePreference,
    alerts,
    fetchAlerts,
    markAlertRead,
    markAllAlertsRead,
  } = useAppStore();
  const themePreference = useAppStore((s) => s.themePreference);
  const isDark = themePreference === 'dark';
  const insets = useSafeAreaInsets();
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [notifications, setNotifications] = useState<InAppNotificationItem[]>([]);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const latestReading = readings[0];
  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-lg',
    small: 'text-xl',
    medium: 'text-2xl',
    large: 'text-[28px]',
    xlarge: 'text-[32px]',
  });
  const sectionBodyClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-xs',
    small: 'text-[13px]',
    medium: 'text-[15px]',
    large: 'text-[17px]',
    xlarge: 'text-[19px]',
  });

  const textPrimaryClassName = isDark ? 'text-slate-200' : 'text-[#2C3E50]';
  const textSecondaryClassName = isDark ? 'text-slate-400' : 'text-[#7F8C8D]';
  const captionClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-[11px]',
    small: 'text-xs',
    medium: 'text-sm',
    large: 'text-base',
    xlarge: 'text-lg',
  });
  const greetingClassName = getFontClass(fontSizePreference, {
    small: 'text-base',
    medium: 'text-lg',
    large: 'text-xl',
    xlarge: 'text-2xl',
  });
  const readingValueClassName = getFontClass(fontSizePreference, {
    small: 'text-[48px]',
    medium: 'text-[52px]',
    large: 'text-[60px]',
    xlarge: 'text-[64px]',
  });
  const readingUnitClassName = getFontClass(fontSizePreference, {
    small: 'text-lg',
    medium: 'text-xl',
    large: 'text-2xl',
    xlarge: 'text-[28px]',
  });
  const primaryActionClassName = getFontClass(fontSizePreference, {
    small: 'text-base',
    medium: 'text-lg',
    large: 'text-xl',
    xlarge: 'text-2xl',
  });
  const cardTitleClassName = getFontClass(fontSizePreference, {
    small: 'text-[15px]',
    medium: 'text-[17px]',
    large: 'text-[19px]',
    xlarge: 'text-[21px]',
  });
  const notificationBadgeFontSize = getFontNumber(fontSizePreference, {
    small: 11,
    medium: 12,
    large: 13,
    xlarge: 14,
  });
  const unreadNotificationsCount = useMemo(
    () => {
      const serverItems = alerts.map((alert) => ({
        id: `alert-${alert.id}`,
        type: 'system' as const,
        title: alert.alertLevel === 'critical' ? 'แจ้งเตือนความดันระดับวิกฤต' : 'แจ้งเตือนผลวัดความดัน',
        body: alert.alertMessage,
        createdAt: alert.createdAt,
        readAt: alert.readAt,
      }));
      const items = serverItems.length > 0 ? serverItems : notifications;
      return items.filter((item) => !item.readAt).length;
    },
    [alerts, notifications],
  );

  const notificationItems = useMemo<InAppNotificationItem[]>(() => {
    const serverItems: InAppNotificationItem[] = alerts.map((alert) => ({
      id: `alert-${alert.id}`,
      type: 'system',
      title: alert.alertLevel === 'critical' ? 'แจ้งเตือนความดันระดับวิกฤต' : 'แจ้งเตือนผลวัดความดัน',
      body: alert.alertMessage,
      createdAt: alert.createdAt,
      readAt: alert.readAt,
    }));

    return serverItems.length > 0 ? serverItems : notifications;
  }, [alerts, notifications]);

  useEffect(() => {
    let active = true;

    const hydrateNotifications = async () => {
      const items = await getInAppNotifications({
        userId: user?.id,
        readings,
      });
      if (active) {
        setNotifications(items);
      }
    };

    void hydrateNotifications();
    if (user?.id) {
      void fetchAlerts();
    }

    return () => {
      active = false;
    };
  }, [fetchAlerts, readings, user?.id]);

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

  const handleGenerateReport = async () => {
    if (isGeneratingReport) return;
    if (readings.length === 0) {
      Alert.alert('ยังไม่มีข้อมูล', 'กรุณาบันทึกผลวัดความดันก่อนสร้างรายงาน');
      return;
    }

    setIsGeneratingReport(true);
    try {
      const result = await shareReadingsExport({
        dataType: 'readings',
        format: 'pdf',
        readings,
        posts: [],
        userName: user ? `${user.firstname} ${user.lastname}`.trim() : undefined,
      });

      if (result === 'unsupported-platform') {
        Alert.alert('ไม่รองรับ', 'การส่งออกไฟล์ยังไม่รองรับบนเวอร์ชันเว็บ');
      } else if (result === 'unsupported-device') {
        Alert.alert('ไม่รองรับ', 'อุปกรณ์นี้ไม่รองรับการแชร์ไฟล์');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ไม่สามารถสร้างรายงานได้';
      Alert.alert('เกิดข้อผิดพลาด', message);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const handleNotificationPress = async (notificationId: string) => {
    if (notificationId.startsWith('alert-')) {
      await markAlertRead(notificationId.replace('alert-', ''));
      return;
    }

    await markNotificationAsRead({
      userId: user?.id,
      notificationId,
    });
    setNotifications((current) =>
      current.map((item) =>
        item.id === notificationId ? { ...item, readAt: new Date() } : item,
      ),
    );
  };

  const handleMarkAllNotificationsRead = async () => {
    const unreadAlertIds = notificationItems
      .filter((item) => !item.readAt && item.id.startsWith('alert-'))
      .map((item) => item.id.replace('alert-', ''));
    const unreadIds = notificationItems
      .filter((item) => !item.readAt)
      .filter((item) => !item.id.startsWith('alert-'))
      .map((item) => item.id);

    if (unreadAlertIds.length > 0) {
      await markAllAlertsRead();
    }

    if (unreadIds.length === 0) return;

    await markAllNotificationsAsRead({
      userId: user?.id,
      notificationIds: unreadIds,
    });
    setNotifications((current) =>
      current.map((item) => ({ ...item, readAt: item.readAt ?? new Date() })),
    );
  };

  return (
    <GradientBackground safeArea={false}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 108,
        }}
      >
        {/* Header */}
        <FadeInView delay={100}>
          <View className="flex-row justify-between items-center px-4 py-4">
            <View className="flex-row items-center">
              <Avatar
                uri={user?.avatar ? toDisplayImageUri(user.avatar) : undefined}
                name={user?.firstname}
                size="md"
                className={
                  (isDark ? 'bg-[#0F172A]' : 'bg-white') +
                  ' w-[50px] h-[50px] mr-3 shadow-md'
                }
                fallback={
                  <View
                    className={
                      (isDark ? 'bg-[#111827]' : 'bg-[#F0F0F0]') +
                      ' w-[50px] h-[50px] rounded-full overflow-hidden mr-3 shadow-md items-center justify-center'
                    }
                  >
                    <Ionicons name="person" size={24} color={Colors.text.secondary} />
                  </View>
                }
              />
              <Text className={greetingClassName + ' font-semibold ' + textPrimaryClassName}>
                สวัสดี, คุณ {user?.firstname || 'ผู้ใช้'}
              </Text>
            </View>
            <AnimatedPressable
              onPress={() => setShowNotificationsModal(true)}
              className={(isDark ? 'bg-[#0F172A]' : 'bg-white') + ' p-2 rounded-xl shadow-md relative'}
            >
              <Ionicons name="notifications-outline" size={26} color={isDark ? '#E2E8F0' : Colors.text.primary} />
              {unreadNotificationsCount > 0 ? (
                <View className="absolute -top-1 -right-1 min-w-[20px] h-5 rounded-full bg-red-500 items-center justify-center px-1">
                  <Text className="text-white font-bold" style={{ fontSize: notificationBadgeFontSize }}>
                    {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                  </Text>
                </View>
              ) : null}
            </AnimatedPressable>
          </View>
        </FadeInView>

        {/* Latest Reading Card */}
        <ScaleOnMount delay={200}>
          <View className="mx-4 rounded-3xl overflow-hidden shadow-lg shadow-black/15">
            <LinearGradient
              colors={isDark ? ['#0F172A', '#111827'] : ['#FFFFFF', '#FFFFFF']}
              className="p-5 rounded-3xl border border-white/80"
            >
              <Text className={'text-center mb-3 font-medium ' + captionClassName + ' ' + textSecondaryClassName}>
                ผลการวัดล่าสุด {latestReading ? formatThaiDate(latestReading.measuredAt) : '-'}
              </Text>
              
              {latestReading ? (
                <>
                  <PulseView active={true}>
                  <View className="flex-row justify-center items-baseline mb-3">
                    <Text className={isDark ? `${readingValueClassName} font-bold text-slate-100` : `${readingValueClassName} font-bold text-[#1a1a1a]`}>
                      {latestReading.systolic}
                    </Text>
                      <Text className={isDark ? `${readingValueClassName} font-bold text-slate-100 mx-1` : `${readingValueClassName} font-bold text-[#1a1a1a] mx-1`}>
                        /
                      </Text>
                      <Text className={isDark ? `${readingValueClassName} font-bold text-slate-100` : `${readingValueClassName} font-bold text-[#1a1a1a]`}>
                        {latestReading.diastolic}
                      </Text>
                      <Text className={readingUnitClassName + ' font-semibold ml-2 ' + textSecondaryClassName}>
                        mmHg
                      </Text>
                    </View>
                  </PulseView>
                  
                  <View className="flex-row justify-center items-center">
                    <View className="flex-row items-center bg-[#FDE8E8] px-3 py-1.5 rounded-full">
                      <Ionicons name="heart" size={20} color={Colors.heartRate.icon} />
                      <Text className={captionClassName + " text-[#E91E63] ml-1.5 font-semibold"}>{latestReading.pulse} bpm</Text>
                    </View>
                    <View
                      className={
                        'flex-row items-center px-3 py-1.5 rounded-full ml-4 ' +
                        statusUi[latestReading.status].pill
                      }
                    >
                      <View className={'w-2 h-2 rounded-full mr-1.5 ' + statusUi[latestReading.status].dot} />
                      <Text className={'font-semibold ' + captionClassName + ' ' + statusUi[latestReading.status].text}>
                        สถานะ: {getStatusText(latestReading.status)}
                      </Text>
                    </View>
                  </View>
                </>
              ) : (
                <Text className={'text-center ' + sectionBodyClassName + ' ' + textSecondaryClassName}>
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
              colors={['#A879E8', '#7E57C2', '#5E35B1']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              className="flex-row items-center justify-center py-4 rounded-2xl shadow-lg"
            >
              <View className={(isDark ? 'bg-[#0F172A]' : 'bg-white') + ' w-11 h-11 rounded-xl items-center justify-center mr-3'}>
                <Ionicons name="camera" size={26} color="#7E57C2" />
              </View>
              <Text className={`text-white font-semibold ${primaryActionClassName}`}>คลิกที่นี่ เพื่อ ถ่ายภาพวัดความดัน</Text>
            </LinearGradient>
          </AnimatedPressable>
        </FadeInView>

        {latestGuidance ? (
          <FadeInView delay={350}>
            <View className="px-4 mt-4">
              <View
                className={
                  (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white border border-white/80') +
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
                    <Text className={primaryActionClassName + ' font-bold ' + textPrimaryClassName}>
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
                        <Text className={`text-white font-bold ${primaryActionClassName}`}>
                          โทร 1669
                        </Text>
                      </LinearGradient>
                    </AnimatedPressable>
                    <AnimatedPressable onPress={() => router.push('/help' as Href)} className="flex-1">
                      <View className={(isDark ? 'bg-[#111827]' : 'bg-[#EBF5FB]') + ' rounded-2xl py-3.5 items-center justify-center'}>
                        <Text className={`${primaryActionClassName} font-semibold ${isDark ? 'text-slate-100' : 'text-[#2C3E50]'}`}>
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
                    (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white border border-white/80') +
                    ' rounded-2xl p-[18px] min-h-[170px] items-center shadow-md'
                  }
                >
                  <View className="w-[72px] h-[72px] bg-[#EBF5FB] rounded-2xl items-center justify-center mb-2">
                    <Ionicons name="trending-up" size={32} color="#35B8E8" />
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
                onPress={() => void handleGenerateReport()}
                disabled={isGeneratingReport}
                className="flex-1 ml-4"
              >
                <View
                  className={
                    (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white border border-white/80') +
                    ' rounded-2xl p-[18px] min-h-[170px] items-center shadow-md'
                  }
                >
                  <Text className={captionClassName + ' mb-1 ' + textSecondaryClassName}>
                    สร้างรายงานสุขภาพ
                  </Text>
                  <LinearGradient
                    colors={['#2C3E50', '#1a1a2e']}
                    className="w-[72px] h-[72px] rounded-2xl items-center justify-center mb-2"
                  >
                    <Text className={captionClassName + " text-white font-bold"}>PDF</Text>
                  </LinearGradient>
                  <Text className={sectionBodyClassName + ' mb-1 ' + textSecondaryClassName}>
                    {isGeneratingReport ? 'กำลังสร้าง...' : 'กดเพื่อสร้าง'}
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
            
            <AnimatedPressable onPress={() => router.push('/health-tips' as Href)} className="mb-3">
              <View
                className={
                  (isDark ? 'bg-[#0F172A] border border-[#334155]' : 'bg-white border border-white/80') +
                  ' rounded-2xl p-4 flex-row items-center shadow-md'
                }
              >
                <View className="w-11 h-11 bg-[#E8F5E9] rounded-full items-center justify-center mr-3">
                  <Ionicons name="leaf" size={22} color="#27AE60" />
                </View>
                <View className="flex-1">
                  <Text className={cardTitleClassName + ' font-semibold ' + textPrimaryClassName}>
                    เคล็ดลับการดูแลสุขภาพ
                  </Text>
                  <Text className={sectionBodyClassName + ' mt-0.5 ' + textSecondaryClassName}>
                    อ่านบทความเกี่ยวกับการดูแลความดันโลหิต
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={Colors.text.secondary} />
              </View>
            </AnimatedPressable>
            
            <AnimatedPressable onPress={() => router.push('/settings' as Href)}>
              <LinearGradient
                colors={['#A879E8', '#7E57C2', '#5E35B1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                className="rounded-2xl p-4 flex-row items-center shadow-lg"
              >
                <View className="w-11 h-11 bg-white/20 rounded-full items-center justify-center mr-3">
                  <Ionicons name="calendar" size={22} color="white" />
                </View>
                <View className="flex-1">
                  <Text className={`text-white font-semibold ${cardTitleClassName}`}>ตั้งการแจ้งเตือน</Text>
                  <Text className={`text-white/80 mt-0.5 ${sectionBodyClassName}`}>เตือนให้วัดความดันเป็นประจำ</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="white" />
              </LinearGradient>
            </AnimatedPressable>
          </View>
        </FadeInView>

        <View className="h-[100px]" />
      </ScrollView>

      <Modal
        visible={showNotificationsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowNotificationsModal(false)}
      >
        <View className="flex-1 bg-black/45 justify-end">
          <View
            className={
              (isDark ? 'bg-[#0B1220] border border-[#1F2937]' : 'bg-white') +
              ' rounded-t-[28px] px-4 pt-4 pb-6 max-h-[80%]'
            }
          >
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-1 pr-3">
                <Text className={titleClassName + ' font-bold ' + textPrimaryClassName}>
                  รายการแจ้งเตือน
                </Text>
                <Text className={sectionBodyClassName + ' mt-1 ' + textSecondaryClassName}>
                  จุดแดงคือรายการที่ยังไม่ได้อ่าน
                </Text>
              </View>
              <AnimatedPressable
                onPress={() => setShowNotificationsModal(false)}
                className={(isDark ? 'bg-[#111827]' : 'bg-[#F3F4F6]') + ' w-10 h-10 rounded-xl items-center justify-center'}
              >
                <Ionicons name="close" size={22} color={isDark ? '#E2E8F0' : '#374151'} />
              </AnimatedPressable>
            </View>

            <View className="flex-row justify-between items-center mb-3">
              <Text className={sectionBodyClassName + ' font-semibold ' + textSecondaryClassName}>
                ยังไม่อ่าน {unreadNotificationsCount} รายการ
              </Text>
              <AnimatedPressable onPress={() => void handleMarkAllNotificationsRead()}>
                <Text className={sectionBodyClassName + ' font-semibold text-[#2563EB]'}>
                  อ่านทั้งหมด
                </Text>
              </AnimatedPressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {notificationItems.length > 0 ? (
                notificationItems.map((item) => {
                  const isUnread = !item.readAt;

                  return (
                    <AnimatedPressable
                      key={item.id}
                      onPress={() => void handleNotificationPress(item.id)}
                      className={
                        (isUnread
                          ? isDark
                            ? 'bg-[#111827] border-[#334155]'
                            : 'bg-white border-white/80'
                          : isDark
                            ? 'bg-[#0F172A] border-[#1F2937]'
                            : 'bg-white border-white/80') +
                        ' rounded-2xl border p-4 mb-3'
                      }
                    >
                      <View className="flex-row items-start">
                        <View className="mr-3 mt-1">
                          <View className="w-10 h-10 rounded-xl items-center justify-center bg-[#EBF5FB]">
                            <Ionicons
                              name="heart-outline"
                              size={20}
                              color="#7E57C2"
                            />
                          </View>
                        </View>
                        <View className="flex-1 pr-2">
                          <View className="flex-row items-center justify-between">
                            <Text className={sectionBodyClassName + ' font-bold ' + textPrimaryClassName}>
                              {item.title}
                            </Text>
                            {isUnread ? <View className="w-3 h-3 rounded-full bg-red-500" /> : null}
                          </View>
                          <Text className={sectionBodyClassName + ' mt-1 leading-6 ' + textSecondaryClassName}>
                            {item.body}
                          </Text>
                          <Text className={captionClassName + ' mt-2 ' + (isUnread ? 'text-[#2563EB]' : textSecondaryClassName)}>
                            {item.createdAt.toLocaleString('th-TH', {
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            {item.readAt ? ' • อ่านแล้ว' : ' • ยังไม่อ่าน'}
                          </Text>
                        </View>
                      </View>
                    </AnimatedPressable>
                  );
                })
              ) : (
                <View
                  className={
                    (isDark ? 'bg-[#111827] border border-[#334155]' : 'bg-white border border-white/80') +
                    ' rounded-2xl p-5'
                  }
                >
                  <Text className={sectionBodyClassName + ' font-semibold ' + textPrimaryClassName}>
                    ยังไม่มีแจ้งเตือน
                  </Text>
                  <Text className={sectionBodyClassName + ' mt-1 leading-6 ' + textSecondaryClassName}>
                    เมื่อมีการวัดใหม่หรือเหตุการณ์สำคัญในแอป รายการจะแสดงที่นี่
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </GradientBackground>
  );
}
