import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Text, View, type ViewStyle } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
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
  const isDark = themePreference === 'dark';

  const gradientColors: [string, string] = isDanger
    ? isDark
      ? ['#3B0A0A', '#2A0A0A']
      : ['#FEE2E2', '#FECACA']
    : isDark
      ? ['#0F172A', '#111827']
      : ['#FFFFFF', '#F8FAFC'];

  const borderColor = isDanger
    ? isDark
      ? '#7F1D1D'
      : '#FECACA'
    : isDark
      ? '#334155'
      : '#E5E7EB';

  const titleColor = isDanger ? '#EF4444' : isDark ? '#E2E8F0' : '#2C3E50';
  const arrowBg = isDark ? '#1F2937' : '#F3F4F6';
  const arrowColor = isDanger ? '#EF4444' : isDark ? '#94A3B8' : '#9CA3AF';

  const containerShadowStyle: ViewStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  };
  
  return (
    <AnimatedPressable onPress={onPress} className="mb-2.5 rounded-2xl overflow-hidden" style={containerShadowStyle}>
      <LinearGradient
        colors={gradientColors}
        className="flex-row items-center p-[14px] rounded-2xl border"
        style={{ borderColor }}
      >
        <View
          className={
            'w-[42px] h-[42px] rounded-[12px] items-center justify-center overflow-hidden' +
            (isDanger ? ' bg-[#FEE2E2]' : '')
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
        <Text className="flex-1 ml-3.5 text-[15px] font-semibold" style={{ color: titleColor }}>
          {title}
        </Text>
        {showArrow && (
          <View className="w-7 h-7 rounded-full items-center justify-center" style={{ backgroundColor: arrowBg }}>
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
