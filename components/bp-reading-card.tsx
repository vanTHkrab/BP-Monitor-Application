import { Colors, getStatusColor } from '@/constants/colors';
import { formatShortDate, getRelativeTime } from '@/data/mockData';
import { useAppStore } from '@/store/useAppStore';
import { BloodPressureReading } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
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
  const isDark = themePreference === 'dark';

  const statusColor = getStatusColor(reading.status);
  
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
      return ['#0F172A', '#111827'];
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

  const getBorderColor = () => {
    if (isDark) return '#334155';
    switch (reading.status) {
      case 'normal':
        return '#81C784';
      case 'low':
        return '#64B5F6';
      case 'elevated':
        return '#FFD54F';
      case 'high':
        return '#FFB74D';
      case 'critical':
        return '#E57373';
      default:
        return '#E0E0E0';
    }
  };

  const dateText = showFullDate 
    ? formatShortDate(reading.measuredAt)
    : getRelativeTime(reading.measuredAt);

  const cardShadowStyle: ViewStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  };

  const badgeShadowStyle: ViewStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  };

  return (
    <AnimatedPressable onPress={onPress} className="mb-3">
      <LinearGradient
        colors={getCardColors()}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="rounded-[20px] p-4 border-2"
        style={[cardShadowStyle, { borderColor: getBorderColor() }]}
      >
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            <Text className={(isDark ? 'text-slate-400' : 'text-gray-600') + ' text-sm mb-1.5 font-medium min-h-[20px]'}>
              {dateText}
            </Text>
            <View className="flex-row items-baseline">
              <Text className={(isDark ? 'text-slate-200' : 'text-[#1a1a1a]') + ' text-[38px] font-bold'}>{reading.systolic}</Text>
              <Text className={(isDark ? 'text-slate-200' : 'text-[#1a1a1a]') + ' text-[38px] font-bold mx-0.5'}>/</Text>
              <Text className={(isDark ? 'text-slate-200' : 'text-[#1a1a1a]') + ' text-[38px] font-bold'}>{reading.diastolic}</Text>
              <Text className={(isDark ? 'text-slate-400' : 'text-gray-600') + ' text-base ml-2 font-medium'}>mmHg</Text>
            </View>
            <View className="flex-row items-center mt-2">
              <Ionicons name="heart" size={18} color={Colors.heartRate.icon} />
              <Text className={(isDark ? 'text-slate-400' : 'text-gray-600') + ' ml-1.5 text-sm font-medium'}>
                {reading.pulse} bpm
              </Text>
            </View>
          </View>
          
          <View className="items-end gap-2">
            <View className="w-8 h-8 rounded-full items-center justify-center" style={[badgeShadowStyle, { backgroundColor: statusColor }]}>
              <Ionicons name={getStatusIcon()} size={16} color="white" />
            </View>
            <View className="w-8 h-8 rounded-full items-center justify-center" style={{ backgroundColor: statusColor + '30' }}>
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
