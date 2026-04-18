import { useAppStore } from '@/store/useAppStore';
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

  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const wrapperClassName =
    'flex-row items-center rounded-[14px] border-2 px-[14px] py-1 shadow-sm ' +
    (error
      ? `border-red-500 ${isDark ? 'bg-[#2A0A0A]' : 'bg-red-50'}`
      : isFocused
        ? 'border-[#5DADE2] bg-white'
        : `${isDark ? 'border-[#334155] bg-[#0B1220]' : 'border-[#94A3B8] bg-[#F8FAFC]'}`);

  const iconBoxClassName =
    'w-9 h-9 rounded-[10px] items-center justify-center mr-2.5 ' +
    (isFocused
      ? (isDark ? 'bg-[#0B2A3A]' : 'bg-[#EBF5FB]')
      : (isDark ? 'bg-[#111827]' : 'bg-[#F3F4F6]'));

  const iconColor = error
    ? '#EF4444'
    : isFocused
      ? '#3498DB'
      : isDark
        ? '#94A3B8'
        : '#9CA3AF';

  const inputClassName = 'flex-1 font-semibold py-3 ' + (isDark ? 'text-slate-200' : 'text-slate-800');
  const placeholderTextColor = isDark ? '#94A3B8' : '#9CA3AF';
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
      <View className={wrapperClassName}>
        {icon && (
          <View className={iconBoxClassName}>
            <Ionicons
              name={icon}
              size={20}
              color={iconColor}
            />
          </View>
        )}
        <TextInput
          className={inputClassName}
          style={{ fontSize: inputFontSize }}
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
              color={isDark ? '#94A3B8' : '#9CA3AF'}
            />
          </Pressable>
        )}
      </View>
      {error && (
        <Text className="text-red-500 mt-1.5 ml-1 font-semibold" style={{ fontSize: errorFontSize }}>
          {error}
        </Text>
      )}
    </View>
  );
};

export default CustomInput;
