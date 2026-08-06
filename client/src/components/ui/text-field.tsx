/**
 * Form input with a leading icon, focus state, and inline error.
 *
 * Ported from client-old/components/custom-input.tsx. Colours now come from
 * the token file; the font-size preference the old version read is not wired
 * up in this tree yet, so sizes are the old `medium` rung.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { palette, status } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

export type TextFieldProps = {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  icon?: keyof typeof Ionicons.glyphMap;
  secureTextEntry?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: 'tel' | 'email' | 'name' | 'password' | 'new-password' | 'off';
  /**
   * Defaults to RN's `true`. Pass `false` for anything the keyboard has no
   * business improving — an email address, a code, an ID.
   */
  autoCorrect?: boolean;
  editable?: boolean;
  /**
   * Tri-state, and the empty string is meaningful:
   *   `undefined` → normal
   *   `''`        → red border only, no text (companion-field highlight)
   *   `string`    → red border plus the message underneath
   */
  error?: string;
  testID?: string;
};

export function TextField({
  placeholder,
  value,
  onChangeText,
  icon,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete = 'off',
  autoCorrect,
  editable = true,
  error,
  testID,
}: TextFieldProps) {
  const { scheme } = useColorSchemePreference();
  const colors = useTheme();
  const isDark = scheme === 'dark';
  const fontScale = useFontScale();

  const [isPasswordVisible, setPasswordVisible] = useState(false);
  const [isFocused, setFocused] = useState(false);

  const hasError = typeof error === 'string';
  const showErrorText = hasError && error.length > 0;

  /*
   * Unfocused fields use `border-strong`, not `border` and not the surface
   * colour. In light mode this drew `colors.surface` — a white border on a
   * white card — so a field the user had not yet touched had no visible edge
   * and read as text rather than as something to tap. `border` would not have
   * fixed it either: in light mode that token is the background colour, which
   * is right for a divider and far too faint for the outline of a control.
   */
  const borderColor = hasError
    ? status.high
    : isFocused
      ? colors.primary
      : colors['border-strong'];

  const iconColor = hasError
    ? status.high
    : isFocused
      ? colors.primary
      : colors['text-secondary'];

  return (
    <View className="mb-4">
      <View
        className="flex-row items-center rounded-[14px] border-2 px-[14px] py-1"
        style={{
          borderColor,
          backgroundColor: hasError
            ? isDark
              ? '#2A0A0A'
              : '#FEF2F2'
            : isDark
              ? colors['surface-muted']
              : colors.surface,
        }}>
        {icon ? (
          <View
            className="mr-2.5 h-9 w-9 items-center justify-center rounded-[10px]"
            style={{
              backgroundColor: isFocused
                ? isDark
                  ? colors['surface-muted']
                  : palette.lavender
                : isDark
                  ? colors.surface
                  : colors['surface-muted'],
            }}>
            <Ionicons name={icon} size={20} color={iconColor} />
          </View>
        ) : null}

        <TextInput
          testID={testID}
          className="flex-1 py-3 font-semibold"
          style={{ fontSize: Math.round(15 * fontScale), color: colors['text-primary'] }}
          placeholder={placeholder}
          placeholderTextColor={colors['text-secondary']}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          autoCorrect={autoCorrect}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />

        {secureTextEntry ? (
          <Pressable
            onPress={() => setPasswordVisible((visible) => !visible)}
            className="ml-1 p-2"
            accessibilityRole="button"
            accessibilityLabel={isPasswordVisible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
            <Ionicons
              name={isPasswordVisible ? 'eye-off' : 'eye'}
              size={22}
              color={colors['text-secondary']}
            />
          </Pressable>
        ) : null}
      </View>

      {showErrorText ? (
        <ThemedText type="label" className="ml-1 mt-1.5" style={{ color: status.high }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}
