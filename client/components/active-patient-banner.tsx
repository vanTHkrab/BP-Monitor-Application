import { useAppStore } from '@/store/use-app-store';
import { getFontClass } from '@/utils/font-scale';
import { toDisplayImageUri } from '@/utils/storage-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Href, router } from 'expo-router';
import { cssInterop } from 'nativewind';
import React, { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

cssInterop(LinearGradient, { className: 'style' });

/**
 * Banner ลอยอยู่ใต้ status bar ตอน user เป็น caregiver
 * แสดงผู้ป่วยที่กำลัง view + dropdown เปลี่ยน
 */
export const ActivePatientBanner: React.FC = () => {
  const user = useAppStore((s) => s.user);
  const myPatients = useAppStore((s) => s.myPatients);
  const activePatientId = useAppStore((s) => s.activePatientId);
  const setActivePatientId = useAppStore((s) => s.setActivePatientId);
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const insets = useSafeAreaInsets();
  const [pickerOpen, setPickerOpen] = useState(false);

  const bannerTitleClassName = getFontClass(fontSizePreference, {
    small: 'text-[13px]',
    medium: 'text-sm',
    large: 'text-[15px]',
    xlarge: 'text-base',
  });
  const sheetTitleClassName = getFontClass(fontSizePreference, {
    small: 'text-base',
    medium: 'text-lg',
    large: 'text-xl',
    xlarge: 'text-2xl',
  });
  const captionClassName = getFontClass(fontSizePreference, {
    small: 'text-[11px]',
    medium: 'text-xs',
    large: 'text-[13px]',
    xlarge: 'text-sm',
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    small: 'text-[13px]',
    medium: 'text-sm',
    large: 'text-[15px]',
    xlarge: 'text-base',
  });

  const activePatient = useMemo(
    () => myPatients.find((p) => p.id === activePatientId) ?? null,
    [myPatients, activePatientId],
  );

  if (user?.role !== 'caregiver') return null;

  const titleText = activePatient
    ? `กำลังดูข้อมูลของ คุณ ${activePatient.firstname}`
    : 'ยังไม่ได้เลือกผู้ป่วย';

  return (
    <>
      <Pressable
        onPress={() => setPickerOpen(true)}
        style={{ paddingTop: insets.top }}
      >
        <LinearGradient
          colors={['#7E57C2', '#5E35B1']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          className="flex-row items-center px-4 py-2.5"
        >
          <View className="w-8 h-8 rounded-full overflow-hidden bg-white/20 items-center justify-center mr-2.5">
            {activePatient?.avatar ? (
              <Image source={{ uri: toDisplayImageUri(activePatient.avatar) }} className="w-full h-full" />
            ) : (
              <Ionicons name="person" size={16} color="white" />
            )}
          </View>
          <View className="flex-1">
            <Text className="text-white/70 text-[10px]">โหมดผู้ดูแล</Text>
            <Text className={'text-white font-bold ' + bannerTitleClassName} numberOfLines={1}>
              {titleText}
            </Text>
          </View>
          <Ionicons name="chevron-down" size={18} color="white" />
        </LinearGradient>
      </Pressable>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <Pressable className="flex-1 bg-black/50" onPress={() => setPickerOpen(false)}>
          <View className="flex-1" />
        </Pressable>
        <View
          className={
            (isDark ? 'bg-[#0B1220] border-t border-[#1F2937]' : 'bg-white') +
            ' rounded-t-3xl px-4 pt-4 pb-6'
          }
          style={{ paddingBottom: Math.max(insets.bottom + 12, 24) }}
        >
          <View className="flex-row items-center justify-between mb-3">
            <Text className={(isDark ? 'text-slate-100' : 'text-[#2C3E50]') + ' font-bold ' + sheetTitleClassName}>
              เลือกผู้ป่วยที่ดูแล
            </Text>
            <Pressable
              onPress={() => setPickerOpen(false)}
              className={(isDark ? 'bg-[#111827]' : 'bg-gray-100') + ' w-9 h-9 rounded-xl items-center justify-center'}
            >
              <Ionicons name="close" size={20} color={isDark ? '#E2E8F0' : '#374151'} />
            </Pressable>
          </View>

          <ScrollView className="max-h-[420px]" showsVerticalScrollIndicator={false}>
            <Pressable
              onPress={() => {
                void setActivePatientId(null);
                setPickerOpen(false);
              }}
              className={
                (isDark ? 'bg-[#111827] border-[#1F2937]' : 'bg-gray-50 border-gray-100') +
                ' border rounded-2xl px-4 py-3 mb-2 flex-row items-center'
              }
            >
              <View className="w-10 h-10 rounded-full bg-gray-300 items-center justify-center mr-3">
                <Ionicons name="person-outline" size={20} color="white" />
              </View>
              <View className="flex-1">
                <Text className={(isDark ? 'text-slate-200' : 'text-[#2C3E50]') + ' font-semibold'}>
                  ดูข้อมูลตนเอง
                </Text>
                <Text className={(isDark ? 'text-slate-400' : 'text-gray-500') + ' mt-0.5 ' + captionClassName}>
                  ปิดโหมดผู้ดูแลชั่วคราว
                </Text>
              </View>
              {!activePatientId ? <Ionicons name="checkmark-circle" size={22} color="#27AE60" /> : null}
            </Pressable>

            {myPatients.length === 0 ? (
              <View className={(isDark ? 'bg-[#111827]' : 'bg-gray-50') + ' rounded-2xl p-4 items-center'}>
                <Text className={(isDark ? 'text-slate-300' : 'text-gray-600') + ' text-center ' + bodyClassName}>
                  ยังไม่มีผู้ป่วยที่ตอบรับคำเชิญ
                </Text>
                <Pressable
                  onPress={() => {
                    setPickerOpen(false);
                    router.push('/caregivers' as Href);
                  }}
                  className="mt-3"
                >
                  <Text className={'text-[#7E57C2] font-semibold ' + bodyClassName}>จัดการคำเชิญ →</Text>
                </Pressable>
              </View>
            ) : (
              myPatients.map((patient) => {
                const selected = patient.id === activePatientId;
                return (
                  <Pressable
                    key={patient.id}
                    onPress={() => {
                      void setActivePatientId(patient.id);
                      setPickerOpen(false);
                    }}
                    className={
                      (selected
                        ? 'bg-[#EDE7F6] border-[#7E57C2]'
                        : isDark
                          ? 'bg-[#111827] border-[#1F2937]'
                          : 'bg-white border-gray-200') +
                      ' border rounded-2xl px-4 py-3 mb-2 flex-row items-center'
                    }
                  >
                    <View className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 items-center justify-center mr-3">
                      {patient.avatar ? (
                        <Image source={{ uri: toDisplayImageUri(patient.avatar) }} className="w-full h-full" />
                      ) : (
                        <Ionicons name="person" size={20} color="#7F8C8D" />
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className={(selected ? 'text-[#5E35B1]' : isDark ? 'text-slate-200' : 'text-[#2C3E50]') + ' font-semibold'}>
                        คุณ {patient.firstname} {patient.lastname}
                      </Text>
                      <Text className={(isDark ? 'text-slate-400' : 'text-gray-500') + ' mt-0.5 ' + captionClassName}>
                        {patient.relationship ?? 'ผู้ป่วย'} • {patient.phone}
                      </Text>
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={22} color="#7E57C2" /> : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
};

export default ActivePatientBanner;
