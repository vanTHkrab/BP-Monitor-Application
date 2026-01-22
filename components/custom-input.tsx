import { useAppStore } from '@/store/useAppStore';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';

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
  const isDark = themePreference === 'dark';

  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const borderColor = error
    ? '#EF4444'
    : isFocused
      ? '#5DADE2'
      : isDark
        ? '#334155'
        : '#94A3B8';

  const backgroundColor = error
    ? (isDark ? '#2A0A0A' : '#FEF2F2')
    : isFocused
      ? '#FFFFFF'
      : isDark
        ? '#0B1220'
        : '#F8FAFC';

  const baseShadowStyle: ViewStyle | undefined = Platform.OS !== 'web'
    ? {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: isDark ? 0.15 : 0.07,
        shadowRadius: 6,
        elevation: 2,
      }
    : undefined;

  const focusShadowStyle: ViewStyle | undefined = isFocused && Platform.OS !== 'web'
    ? {
        shadowColor: '#5DADE2',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.18,
        shadowRadius: 10,
        elevation: 3,
      }
    : undefined;

  const wrapperStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: Platform.OS === 'web' ? 1 : 2,
    borderColor,
    backgroundColor,
    paddingHorizontal: 14,
    paddingVertical: 4,
  };

  const iconBg = isFocused
    ? (isDark ? '#0B2A3A' : '#EBF5FB')
    : (isDark ? '#111827' : '#F3F4F6');

  const inputColor = isDark ? '#E2E8F0' : '#2C3E50';
  const placeholderColor = isDark ? '#94A3B8' : '#9CA3AF';

  return (
    <View style={{ marginBottom: 16 }}>
      <View style={[wrapperStyle, baseShadowStyle, focusShadowStyle]}>
        {icon && (
          <View style={[styles.iconBox, { backgroundColor: iconBg }]}>
            <Ionicons
              name={icon}
              size={20}
              color={error ? '#EF4444' : isFocused ? '#3498DB' : isDark ? '#94A3B8' : '#9CA3AF'}
            />
          </View>
        )}
        <TextInput
          style={[styles.input, { color: inputColor }]}
          placeholder={placeholder}
          placeholderTextColor={placeholderColor}
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
          <Pressable onPress={() => setIsPasswordVisible(!isPasswordVisible)} style={{ padding: 8, marginLeft: 4 }}>
            <Ionicons
              name={isPasswordVisible ? 'eye-off' : 'eye'}
              size={22}
              color={isDark ? '#94A3B8' : '#9CA3AF'}
            />
          </Pressable>
        )}
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 12,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: 6,
    marginLeft: 4,
    fontWeight: '600',
  },
});

export default CustomInput;
