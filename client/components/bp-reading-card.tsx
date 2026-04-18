import { Colors, type BPStatus } from '@/constants/colors';
import { formatShortDate, getRelativeTime } from '@/data/mockData';
import { useAppStore } from '@/store/useAppStore';
import { BloodPressureReading } from '@/types';
import { getFontClass } from '@/utils/font-scale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import React from 'react';
import { Text, View } from 'react-native';
import { AnimatedPressable } from './animated-components';

cssInterop(LinearGradient, { className: 'style' });

interface BPReadingCardProps {
  reading: BloodPressureReading;
  onPress?: () => void;
  showFullDate?: boolean;
  index?: number;
}

export const BPReadingCard: React.FC<BPReadingCardProps> = ({
  reading,
  onPress,
  showFullDate = false,
  index = 0,
}) => {
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const titleSizeClass = getFontClass(fontSizePreference, {
    xsmall: 'text-[30px]',
    small: 'text-[34px]',
    medium: 'text-[38px]',
    large: 'text-[42px]',
    xlarge: 'text-[46px]',
  });
  const metaSizeClass = getFontClass(fontSizePreference, {
    xsmall: 'text-xs',
    small: 'text-[13px]',
    medium: 'text-sm',
    large: 'text-base',
    xlarge: 'text-[17px]',
  });

  const statusColor = Colors.status[reading.status as BPStatus];
  const statusClass: Record<BPStatus, { solid: string; soft: string; border: string }> = {
    low: { solid: 'bg-[#3498DB]', soft: 'bg-[#3498DB]/30', border: 'border-[#64B5F6]' },
    normal: { solid: 'bg-[#27AE60]', soft: 'bg-[#27AE60]/30', border: 'border-[#81C784]' },
    elevated: { solid: 'bg-[#F39C12]', soft: 'bg-[#F39C12]/30', border: 'border-[#FFD54F]' },
    high: { solid: 'bg-[#E74C3C]', soft: 'bg-[#E74C3C]/30', border: 'border-[#FFB74D]' },
    critical: { solid: 'bg-[#8E44AD]', soft: 'bg-[#8E44AD]/30', border: 'border-[#E57373]' },
  };

  const borderClassName = isDark ? 'border-[#334155]' : statusClass[reading.status as BPStatus].border;
  
  const getStatusIcon = () => {
    switch (reading.status) {
      case 'normal':
        return 'checkmark';
      case 'low':
        return 'arrow-down';
      case 'elevated':
        return 'warning';
      case 'high':
        return 'arrow-up';
      case 'critical':
        return 'alert';
      default:
        return 'checkmark';
    }
  };

  const getCardColors = (): [string, string] => {
    if (isDark) {
      return ['#0B1830', '#12243D'];
    }
    switch (reading.status) {
      case 'normal':
        return ['#E8F5E9', '#C8E6C9'];
      case 'low':
        return ['#E3F2FD', '#BBDEFB'];
      case 'elevated':
        return ['#FFF8E1', '#FFECB3'];
      case 'high':
        return ['#FFF3E0', '#FFE0B2'];
      case 'critical':
        return ['#FFEBEE', '#FFCDD2'];
      default:
        return ['#FFFFFF', '#F5F5F5'];
    }
  };

  const dateText = showFullDate 
    ? formatShortDate(reading.measuredAt)
    : getRelativeTime(reading.measuredAt);

  return (
    <AnimatedPressable onPress={onPress} className="mb-3">
      <LinearGradient
        colors={getCardColors()}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className={
          'rounded-[20px] p-4 border-2 shadow-lg ' +
          borderClassName +
          ' ' +
          (isDark ? 'shadow-black/40' : 'shadow-black/15')
        }
      >
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            <Text className={(isDark ? 'text-slate-400' : 'text-gray-600') + ' ' + metaSizeClass + ' mb-1.5 font-medium min-h-[20px]'}>
              {dateText}
            </Text>
            <View className="flex-row items-baseline">
              <Text className={(isDark ? 'text-slate-100' : 'text-[#1a1a1a]') + ' ' + titleSizeClass + ' font-bold'}>{reading.systolic}</Text>
              <Text className={(isDark ? 'text-slate-100' : 'text-[#1a1a1a]') + ' ' + titleSizeClass + ' font-bold mx-0.5'}>/</Text>
              <Text className={(isDark ? 'text-slate-100' : 'text-[#1a1a1a]') + ' ' + titleSizeClass + ' font-bold'}>{reading.diastolic}</Text>
              <Text className={(isDark ? 'text-slate-400' : 'text-gray-600') + ' ' + metaSizeClass + ' ml-2 font-medium'}>mmHg</Text>
            </View>
            <View className="flex-row items-center mt-2">
              <Ionicons name="heart" size={18} color={Colors.heartRate.icon} />
              <Text className={(isDark ? 'text-slate-400' : 'text-gray-600') + ' ml-1.5 ' + metaSizeClass + ' font-medium'}>
                {reading.pulse} bpm
              </Text>
            </View>
          </View>
          
          <View className="items-end gap-2">
            <View
              className={
                'w-8 h-8 rounded-full items-center justify-center shadow-md shadow-black/20 ' +
                statusClass[reading.status as BPStatus].solid
              }
            >
              <Ionicons name={getStatusIcon()} size={16} color="white" />
            </View>
            <View
              className={
                'w-8 h-8 rounded-full items-center justify-center ' +
                statusClass[reading.status as BPStatus].soft
              }
            >
              <Ionicons 
                name={reading.status === 'normal' ? 'checkmark-circle' : 'alert-circle'} 
                size={18} 
                color={statusColor} 
              />
            </View>
          </View>
        </View>
      </LinearGradient>
    </AnimatedPressable>
  );
};

export default BPReadingCard;
