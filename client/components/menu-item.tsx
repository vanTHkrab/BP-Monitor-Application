import { Tokens } from '@/constants/colors';
import { useAppStore } from '@/store/use-app-store';
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
  const t = Tokens[isDark ? 'dark' : 'light'];

  const gradientColors: [string, string] = isDanger
    ? isDark
      ? ['#3B1411', t.surface]                 // danger dark: muted red wash → surface
      : [t.statusHighBg, '#FBDCD3']           // danger light: soft red tint
    : isDark
      ? [t.surface, t.surfaceMuted]           // default dark: surface elevation
      : [t.surface, t.brandSoft];             // default light: surface → brand-soft for warmth

  const borderColor = isDanger
    ? (isDark ? '#5A2018' : '#F2C4B8')
    : (isDark ? t.border : t.border);

  const titleColor = isDanger ? t.statusHigh : t.inkPrimary;
  const titleSizeClassName = getFontClass(fontSizePreference, {
    xsmall: 'text-[13px]',
    small: 'text-[14px]',
    medium: 'text-[15px]',
    large: 'text-[18px]',
    xlarge: 'text-[20px]',
  });
  const arrowBgColor = isDark ? t.surfaceMuted : t.brandSoft;
  const arrowColor = iconColor ?? (isDanger ? t.statusHigh : isDark ? t.inkSecondary : t.brand);
  const iconBoxBg = isDanger ? (isDark ? '#3B1411' : t.statusHighBg) : 'transparent';

  return (
    <AnimatedPressable onPress={onPress} className="mb-2.5 rounded-2xl overflow-hidden shadow-md shadow-black/10">
      <LinearGradient
        colors={gradientColors}
        className="flex-row items-center p-[14px] rounded-2xl border"
        style={{ borderColor }}
      >
        <View
          className="w-[42px] h-[42px] rounded-[12px] items-center justify-center overflow-hidden"
          style={{ backgroundColor: iconBoxBg }}
        >
          {isDanger ? (
            <Ionicons
              name={icon}
              size={22}
              color={t.statusHigh}
            />
          ) : (
            <LinearGradient
              colors={t.brandGradient}
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
        <Text
          className={'flex-1 ml-3.5 font-semibold pr-2 ' + titleSizeClassName}
          style={{ color: titleColor }}
        >
          {title}
        </Text>
        {showArrow && (
          <View
            className="w-7 h-7 rounded-full items-center justify-center"
            style={{ backgroundColor: arrowBgColor }}
          >
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
