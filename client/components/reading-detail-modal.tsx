import { UIImage } from '@/components/ui/image';
import { Colors, type BPStatus } from '@/constants/colors';
import { formatShortDate } from '@/data/mockData';
import { useResolvedImageUri } from '@/hooks/use-resolved-image-uri';
import { useAppStore } from '@/store/use-app-store';
import { BloodPressureReading } from '@/types';
import { getFontClass } from '@/utils/font-scale';
import { toDisplayImageUri } from '@/utils/storage-image';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';

interface ReadingDetailModalProps {
  reading: BloodPressureReading | null;
  visible: boolean;
  onClose: () => void;
}

const statusLabel: Record<BPStatus, string> = {
  low: 'ความดันต่ำ',
  normal: 'ปกติ',
  elevated: 'เริ่มสูง',
  high: 'สูง',
  critical: 'สูงมาก',
};

const formatFullDateTime = (date?: Date) => {
  if (!date) return '-';

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

export function ReadingDetailModal({
  reading,
  visible,
  onClose,
}: ReadingDetailModalProps) {
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const resolvedImageUri = useResolvedImageUri(
    reading?.imageUri ? toDisplayImageUri(reading.imageUri) : undefined,
  );

  const titleClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-lg',
    small: 'text-xl',
    medium: 'text-[22px]',
    large: 'text-2xl',
    xlarge: 'text-[28px]',
  });
  const bodyClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-xs',
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  });
  const captionClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-[11px]',
    small: 'text-xs',
    medium: 'text-sm',
    large: 'text-base',
    xlarge: 'text-lg',
  });
  const readingValueClassName = getFontClass(fontSizePreference, {
    small: 'text-[44px]',
    medium: 'text-[48px]',
    large: 'text-[54px]',
    xlarge: 'text-[60px]',
  });
  const readingSeparatorClassName = getFontClass(fontSizePreference, {
    small: 'text-[38px]',
    medium: 'text-[42px]',
    large: 'text-[48px]',
    xlarge: 'text-[54px]',
  });

  if (!reading) return null;

  const statusColor = Colors.status[reading.status as BPStatus];
  const measuredAt = new Date(reading.measuredAt);
  const createdAt = reading.createdAt ? new Date(reading.createdAt) : undefined;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/45">
        <TouchableOpacity className="flex-1" activeOpacity={1} onPress={onClose} />
        <View className="max-h-[88%] rounded-t-[32px] bg-white dark:bg-slate-950 border-t border-sky-100 dark:border-slate-700 overflow-hidden">
          <View className="px-5 pt-4 pb-3 flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className={titleClassName + ' font-bold text-gray-800 dark:text-slate-100'}>
                รายละเอียดการวัด
              </Text>
              <Text className={captionClassName + ' mt-1 text-gray-500 dark:text-slate-400'}>
                {formatShortDate(measuredAt)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 items-center justify-center"
            >
              <Ionicons name="close" size={22} color={isDark ? '#E2E8F0' : '#334155'} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28 }}
          >
            <View className="rounded-[28px] overflow-hidden mb-4">
              <View className="bg-[#EBF5FB] dark:bg-slate-900 p-5 border border-[#D6EAF8] dark:border-slate-700 rounded-[28px]">
                <View className="flex-row items-end justify-center">
                  <Text className={readingValueClassName + " font-bold text-[#1F2937] dark:text-slate-100"}>
                    {reading.systolic}
                  </Text>
                  <Text className={readingSeparatorClassName + " font-bold text-[#1F2937] dark:text-slate-100 mx-1"}>
                    /
                  </Text>
                  <Text className={readingValueClassName + " font-bold text-[#1F2937] dark:text-slate-100"}>
                    {reading.diastolic}
                  </Text>
                  <Text className={bodyClassName + ' ml-2 mb-2 text-gray-500 dark:text-slate-300'}>
                    mmHg
                  </Text>
                </View>
                <View className="flex-row items-center justify-center mt-2">
                  <Ionicons name="heart" size={18} color={Colors.heartRate.icon} />
                  <Text className={bodyClassName + ' ml-2 font-semibold text-gray-700 dark:text-slate-200'}>
                    ชีพจร {reading.pulse} bpm
                  </Text>
                </View>
              </View>
            </View>

            <View className="flex-row mb-4">
              <View className="flex-1 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 p-3 mr-2">
                <Text className={captionClassName + ' text-gray-500 dark:text-slate-400'}>
                  สถานะ
                </Text>
                <View className="flex-row items-center mt-2">
                  <View style={{ backgroundColor: statusColor }} className="w-3 h-3 rounded-full mr-2" />
                  <Text className={bodyClassName + ' font-bold text-gray-800 dark:text-slate-100'}>
                    {statusLabel[reading.status as BPStatus]}
                  </Text>
                </View>
              </View>
              <View className="flex-1 rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 p-3 ml-2">
                <Text className={captionClassName + ' text-gray-500 dark:text-slate-400'}>
                  แหล่งข้อมูล
                </Text>
                <Text className={bodyClassName + ' mt-2 font-bold text-gray-800 dark:text-slate-100'}>
                  {reading.syncStatus === 'pending-image'
                    ? 'รอซิงก์รูป'
                    : reading.syncStatus === 'pending'
                      ? 'รอซิงก์'
                      : 'ซิงก์แล้ว'}
                </Text>
              </View>
            </View>

            <View className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 p-4 mb-4">
              <InfoRow label="วัดเมื่อ" value={formatFullDateTime(measuredAt)} />
              <InfoRow label="บันทึกเข้าแอป" value={formatFullDateTime(createdAt ?? measuredAt)} />
              <InfoRow label="รหัสรายการ" value={reading.clientId ?? reading.id} last />
            </View>

            <View className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 p-4 mb-4">
              <Text className={bodyClassName + ' font-bold text-gray-800 dark:text-slate-100 mb-3'}>
                รูปเครื่องวัดความดัน
              </Text>
              <UIImage
                source={reading.imageUri ? resolvedImageUri ?? toDisplayImageUri(reading.imageUri) : null}
                className="w-full h-56 rounded-2xl bg-slate-100 dark:bg-slate-800"
                contentFit="cover"
                recyclingKey={reading.id}
                fallback={
                  <View className="h-44 rounded-2xl bg-slate-100 dark:bg-slate-800 items-center justify-center px-4">
                    <Ionicons
                      name={reading.imageUri ? 'image-outline' : 'camera-outline'}
                      size={34}
                      color={isDark ? '#94A3B8' : '#64748B'}
                    />
                    <Text className={captionClassName + ' mt-2 text-center text-gray-500 dark:text-slate-400'}>
                      {reading.imageUri
                        ? 'โหลดรูปไม่ได้ อาจเป็น URL ส่วนตัวหรือเครือข่ายยังไม่พร้อม'
                        : 'รายการนี้ยังไม่มีรูปเครื่องวัดความดัน'}
                    </Text>
                  </View>
                }
              />
            </View>

            <View className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 p-4">
              <Text className={bodyClassName + ' font-bold text-gray-800 dark:text-slate-100'}>
                หมายเหตุ
              </Text>
              <Text className={bodyClassName + ' mt-2 leading-6 text-gray-600 dark:text-slate-300'}>
                {reading.notes?.trim() || 'ไม่มีหมายเหตุเพิ่มเติม'}
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const bodyClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-xs',
    small: 'text-sm',
    medium: 'text-base',
    large: 'text-lg',
    xlarge: 'text-xl',
  });

  return (
    <View className={'flex-row justify-between py-2 ' + (last ? '' : 'border-b border-gray-100 dark:border-slate-700')}>
      <Text className={bodyClassName + ' flex-1 text-gray-500 dark:text-slate-400'}>
        {label}
      </Text>
      <Text className={bodyClassName + ' flex-1 text-right font-semibold text-gray-800 dark:text-slate-100'}>
        {value}
      </Text>
    </View>
  );
}
