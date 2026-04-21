import { useAppStore } from '@/store/useAppStore';
import { getFontClass } from '@/utils/font-scale';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import React from 'react';
import { Text, View } from 'react-native';
import { AnimatedPressable } from './animated-components';

cssInterop(LinearGradient, { className: 'style' });

interface MenuItemProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
  showArrow?: boolean;
  iconColor?: string;
  variant?: 'default' | 'danger';
}

export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  title,
  onPress,
  showArrow = true,
  iconColor,
  variant = 'default',
}) => {
  const isDanger = variant === 'danger';
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';

  const gradientColors: [string, string] = isDanger
    ? isDark
      ? ['#3B0A0A', '#2A0A0A']
      : ['#FEE2E2', '#FECACA']
    : isDark
      ? ['#0F172A', '#111827']
      : ['#FFFFFF', '#F8FAFC'];

  const borderClassName = isDanger
    ? (isDark ? 'border-[#7F1D1D]' : 'border-[#FECACA]')
    : (isDark ? 'border-[#334155]' : 'border-[#E5E7EB]');

  const titleClassName = isDanger ? 'text-red-500' : (isDark ? 'text-slate-200' : 'text-[#2C3E50]');
  const titleSizeClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-[13px]',
    small: 'text-[14px]',
    medium: 'text-[15px]',
    large: 'text-[18px]',
    xlarge: 'text-[20px]',
  });
  const arrowBgClassName = isDark ? 'bg-[#1F2937]' : 'bg-[#F3F4F6]';
  const arrowColor = isDanger ? '#EF4444' : isDark ? '#94A3B8' : '#9CA3AF';
  
  return (
    <AnimatedPressable onPress={onPress} className="mb-2.5 rounded-2xl overflow-hidden shadow-md shadow-black/10">
      <LinearGradient
        colors={gradientColors}
        className={'flex-row items-center p-[14px] rounded-2xl border ' + borderClassName}
      >
        <View
          className={
            'w-[42px] h-[42px] rounded-[12px] items-center justify-center overflow-hidden' +
            (isDanger ? (isDark ? ' bg-[#2A0A0A]' : ' bg-[#FEE2E2]') : '')
          }
        >
          {isDanger ? (
            <Ionicons
              name={icon}
              size={22}
              color="#EF4444"
            />
          ) : (
            <LinearGradient
              colors={['#5DADE2', '#3498DB']}
              className="w-full h-full items-center justify-center rounded-[12px]"
            >
              <Ionicons
                name={icon}
                size={20}
                color="white"
              />
            </LinearGradient>
          )}
        </View>
        <Text className={'flex-1 ml-3.5 font-semibold pr-2 ' + titleSizeClassName + ' ' + titleClassName}>
          {title}
        </Text>
        {showArrow && (
          <View className={'w-7 h-7 rounded-full items-center justify-center ' + arrowBgClassName}>
            <Ionicons 
              name="chevron-forward" 
              size={20} 
              color={arrowColor} 
            />
          </View>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
};

export default MenuItem;
