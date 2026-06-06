import { Tokens } from '@/constants/colors';
import { useAppStore } from '@/store/use-app-store';
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
  const t = Tokens[isDark ? 'dark' : 'light'];

  const getGradientColors = (): readonly [string, string, string] => {
    if (disabled) {
      const muted = t.inkMuted;
      return [muted, muted, muted] as const;
    }
    switch (variant) {
      case 'primary':
        return t.brandGradient;
      case 'secondary':
        // Sage accent gradient is 2-stop; pad with mid value for the 3-stop API.
        return [t.accentGradient[0], t.accent, t.accentGradient[1]] as const;
      case 'danger':
        return [t.dangerGradient[0], t.dangerGradient[0], t.dangerGradient[1]] as const;
      case 'outline':
        return ['transparent', 'transparent', 'transparent'] as const;
      default:
        return t.brandGradient;
    }
  };

  const getTextColor = () => {
    if (disabled) return '#FFFFFF';
    switch (variant) {
      case 'outline':
        return t.brand;
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
        xsmall: 'text-[11px]',
        small: 'text-xs',
        medium: 'text-sm',
        large: 'text-base',
        xlarge: 'text-lg',
      })
    : size === 'large'
      ? getFontClass(fontSizePreference, {
          xsmall: 'text-base',
          small: 'text-lg',
          medium: 'text-xl',
          large: 'text-2xl',
          xlarge: 'text-[28px]',
        })
      : getFontClass(fontSizePreference, {
          xsmall: 'text-sm',
          small: 'text-base',
          medium: 'text-lg',
          large: 'text-xl',
          xlarge: 'text-2xl',
        });

  const shadowStyle: ViewStyle = {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
  };

  const buttonContent = (
    <View className="flex-row items-center justify-center px-1">
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
            numberOfLines={2}
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
      style={style}
    >
      {variant === 'outline' ? (
        <View
          className={`rounded-2xl ${sizeClassName}`}
          style={[
            { backgroundColor: t.surface, borderWidth: 2, borderColor: t.brand },
            shadowStyle,
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
