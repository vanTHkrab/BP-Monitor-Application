import { Colors } from '@/constants/colors';
import { useAppStore } from '@/store/useAppStore';
import { getFontClass } from '@/utils/font-scale';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import React from 'react';
import {
    ActivityIndicator,
    Pressable,
    Text,
    TextStyle,
    View,
    ViewStyle,
} from 'react-native';

interface CustomButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  size?: 'small' | 'medium' | 'large';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  className?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

cssInterop(LinearGradient, { className: 'style' });
cssInterop(Pressable, { className: 'style' });

export const CustomButton: React.FC<CustomButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  icon,
  className,
  style,
  textStyle,
  fullWidth = true,
}) => {
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';

  const getGradientColors = (): [string, string, string] => {
    if (disabled) return ['#BDC3C7', '#BDC3C7', '#BDC3C7'];
    switch (variant) {
      case 'primary':
        return ['#72C9F7', '#5DADE2', '#3498DB'];
      case 'secondary':
        return ['#A569BD', '#8E44AD', '#6B3FA0'];
      case 'danger':
        return ['#F1948A', '#E57373', '#C0392B'];
      case 'outline':
        return ['transparent', 'transparent', 'transparent'];
      default:
        return ['#72C9F7', '#5DADE2', '#3498DB'];
    }
  };

  const getTextColor = () => {
    if (disabled) return '#FFFFFF';
    switch (variant) {
      case 'outline':
        return Colors.primary.blue;
      default:
        return '#FFFFFF';
    }
  };

  const sizeClassName =
    size === 'small'
      ? 'py-[10px] px-[18px]'
      : size === 'large'
        ? 'py-[18px] px-8'
        : 'py-4 px-7';

  const textSizeClassName = size === 'small'
    ? getFontClass(fontSizePreference, {
        small: 'text-xs',
        medium: 'text-sm',
        large: 'text-base',
      })
    : size === 'large'
      ? getFontClass(fontSizePreference, {
          small: 'text-lg',
          medium: 'text-xl',
          large: 'text-2xl',
        })
      : getFontClass(fontSizePreference, {
          small: 'text-base',
          medium: 'text-lg',
          large: 'text-xl',
        });

  const shadowStyle: ViewStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  };

  const buttonContent = (
    <View className="flex-row items-center justify-center">
      {loading ? (
        <ActivityIndicator color={getTextColor()} />
      ) : (
        <>
          {icon}
          <Text
            className={
              `font-bold text-center tracking-wide ${textSizeClassName}` +
              (icon ? ' ml-2' : '')
            }
            style={[{ color: getTextColor() }, textStyle]}
          >
            {title}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      className={(fullWidth ? 'w-full' : '') + (className ? ` ${className}` : '')}
      style={[
        style,
      ]}
    >
      {variant === 'outline' ? (
        <View
          className={
            `rounded-2xl ${sizeClassName} ` +
            (isDark ? 'bg-[#0F172A]' : 'bg-white')
          }
          style={[
            shadowStyle,
            { borderWidth: 2, borderColor: Colors.primary.blue },
          ]}
        >
          {buttonContent}
        </View>
      ) : (
        <LinearGradient
          colors={getGradientColors()}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          className={`rounded-2xl overflow-hidden ${sizeClassName}`}
          style={shadowStyle}
        >
          {buttonContent}
        </LinearGradient>
      )}
    </Pressable>
  );
};

export default CustomButton;
