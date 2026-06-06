import { Tokens, type BPStatus } from '@/constants/colors';
import { formatShortDate, getRelativeTime } from '@/data/mockData';
import { useAppStore } from '@/store/use-app-store';
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

type StatusVisual = {
  fill: string;        // solid status color (icon, dot)
  cardFrom: string;    // light-mode card gradient start
  cardTo: string;      // light-mode card gradient end
};

export const BPReadingCard: React.FC<BPReadingCardProps> = ({
  reading,
  onPress,
  showFullDate = false,
}) => {
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const t = Tokens[isDark ? 'dark' : 'light'];

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

  // Status visuals — fill is theme-aware via Tokens; card gradient stays
  // light-mode tinted-bg so the card carries the status meaning without
  // depending on dark-mode tinting.
  const statusVisuals: Record<BPStatus, StatusVisual> = {
    low: {
      fill: t.statusLow,
      cardFrom: Tokens.light.statusLowBg,
      cardTo: '#CFD9EC',
    },
    normal: {
      fill: t.statusNormal,
      cardFrom: Tokens.light.statusNormalBg,
      cardTo: '#CFE5D6',
    },
    elevated: {
      fill: t.statusElevated,
      cardFrom: Tokens.light.statusElevatedBg,
      cardTo: '#F5E2BD',
    },
    high: {
      fill: t.statusHigh,
      cardFrom: Tokens.light.statusHighBg,
      cardTo: '#F2CFC4',
    },
    critical: {
      fill: t.statusCritical,
      cardFrom: Tokens.light.statusCriticalBg,
      cardTo: '#ECB5A8',
    },
  };

  const v = statusVisuals[reading.status as BPStatus];
  const cardColors: [string, string] = isDark
    ? [t.surface, t.surfaceMuted]
    : [v.cardFrom, v.cardTo];
  const cardBorder = isDark ? t.border : v.fill;

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

  const dateText = showFullDate
    ? formatShortDate(reading.measuredAt)
    : getRelativeTime(reading.measuredAt);

  const numberColor = t.inkPrimary;
  const metaColor = t.inkSecondary;

  return (
    <AnimatedPressable onPress={onPress} className="mb-3">
      <LinearGradient
        colors={cardColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className={
          'rounded-[20px] p-4 border-2 shadow-lg ' +
          (isDark ? 'shadow-black/40' : 'shadow-black/15')
        }
        style={{ borderColor: cardBorder }}
      >
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            <Text
              className={metaSizeClass + ' mb-1.5 font-medium min-h-[20px]'}
              style={{ color: metaColor }}
            >
              {dateText}
            </Text>
            <View className="flex-row items-baseline">
              <Text className={titleSizeClass + ' font-bold'} style={{ color: numberColor }}>{reading.systolic}</Text>
              <Text className={titleSizeClass + ' font-bold mx-0.5'} style={{ color: numberColor }}>/</Text>
              <Text className={titleSizeClass + ' font-bold'} style={{ color: numberColor }}>{reading.diastolic}</Text>
              <Text className={metaSizeClass + ' ml-2 font-medium'} style={{ color: metaColor }}>mmHg</Text>
            </View>
            <View className="flex-row items-center mt-2">
              <Ionicons name="heart" size={18} color={t.brand} />
              <Text
                className={'ml-1.5 ' + metaSizeClass + ' font-medium'}
                style={{ color: metaColor }}
              >
                {reading.pulse} bpm
              </Text>
            </View>
          </View>

          <View className="items-end gap-2">
            <View
              className="w-8 h-8 rounded-full items-center justify-center shadow-md shadow-black/20"
              style={{ backgroundColor: v.fill }}
            >
              <Ionicons name={getStatusIcon()} size={16} color="white" />
            </View>
            <View
              className="w-8 h-8 rounded-full items-center justify-center"
              style={{ backgroundColor: v.fill + '33' /* ~20% alpha */ }}
            >
              <Ionicons
                name={reading.status === 'normal' ? 'checkmark-circle' : 'alert-circle'}
                size={18}
                color={v.fill}
              />
            </View>
          </View>
        </View>
      </LinearGradient>
    </AnimatedPressable>
  );
};

export default BPReadingCard;
