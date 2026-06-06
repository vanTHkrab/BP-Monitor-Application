import { Tokens } from '@/constants/colors';
import { useAppStore } from '@/store/use-app-store';
import { getFontNumber } from '@/utils/font-scale';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

interface CustomInputProps {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  icon?: keyof typeof Ionicons.glyphMap;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'numeric' | 'phone-pad' | 'email-address';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  editable?: boolean;
  error?: string;
}

export const CustomInput: React.FC<CustomInputProps> = ({
  placeholder,
  value,
  onChangeText,
  icon,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  editable = true,
  error,
}) => {
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === 'dark';
  const t = Tokens[isDark ? 'dark' : 'light'];

  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  // `error` is a tri-state:
  //   undefined → normal state
  //   ""        → red border + icon, no text (companion-field highlight)
  //   string    → red border + icon + text below
  const hasError = typeof error === 'string';
  const showErrorText = hasError && error.length > 0;

  const wrapperBackground = hasError
    ? (isDark ? '#2A1411' : t.statusHighBg)
    : isFocused
      ? t.surface
      : isDark
        ? t.surfaceMuted
        : t.surface;

  const wrapperBorder = hasError
    ? t.statusHigh
    : isFocused
      ? t.brand
      : isDark
        ? t.border
        : t.border;

  const iconBoxBackground = isFocused
    ? (isDark ? '#3A2820' : t.brandSoft)
    : (isDark ? t.surface : t.surfaceMuted);

  const iconColor = hasError
    ? t.statusHigh
    : isFocused
      ? t.brand
      : t.inkMuted;

  const inputColor = t.inkPrimary;
  const placeholderTextColor = t.inkMuted;
  const inputFontSize = getFontNumber(fontSizePreference, {
    small: 14,
    medium: 15,
    large: 18,
  });
  const errorFontSize = getFontNumber(fontSizePreference, {
    small: 12,
    medium: 13,
    large: 15,
  });

  return (
    <View className="mb-4">
      <View
        className="flex-row items-center rounded-[14px] border-2 px-[14px] py-1 shadow-sm"
        style={{ backgroundColor: wrapperBackground, borderColor: wrapperBorder }}
      >
        {icon && (
          <View
            className="w-9 h-9 rounded-[10px] items-center justify-center mr-2.5"
            style={{ backgroundColor: iconBoxBackground }}
          >
            <Ionicons
              name={icon}
              size={20}
              color={iconColor}
            />
          </View>
        )}
        <TextInput
          className="flex-1 font-semibold py-3"
          style={{ fontSize: inputFontSize, color: inputColor }}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          editable={editable}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />
        {secureTextEntry && (
          <Pressable onPress={() => setIsPasswordVisible(!isPasswordVisible)} className="p-2 ml-1">
            <Ionicons
              name={isPasswordVisible ? 'eye-off' : 'eye'}
              size={22}
              color={t.inkMuted}
            />
          </Pressable>
        )}
      </View>
      {showErrorText && (
        <Text
          className="mt-1.5 ml-1 font-semibold"
          style={{ fontSize: errorFontSize, color: t.statusHigh }}
        >
          {error}
        </Text>
      )}
    </View>
  );
};

export default CustomInput;
