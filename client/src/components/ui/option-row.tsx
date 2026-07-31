/**
 * Single-choice row of pills.
 *
 * Moved out of `modules/auth/components/` — nothing about it is
 * auth-specific, and `app/settings.tsx` needs the same picker for theme and
 * font-size that the register form uses for gender.
 */
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type OptionRowItem<T extends string> = { value: T; label: string };

export type OptionRowProps<T extends string> = {
  label: string;
  options: readonly OptionRowItem<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  /**
   * Whether tapping the already-selected option clears it to `null`.
   * Correct for an optional field (gender); wrong for a setting that must
   * always have a value (theme, font size) — those pass `false`.
   */
  clearable?: boolean;
};

export function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
  clearable = true,
}: OptionRowProps<T>) {
  const colors = useTheme();

  return (
    <View className="mb-4">
      <Text className="mb-2 ml-1 font-semibold" style={{ fontSize: 13, color: colors['text-secondary'] }}>
        {label}
      </Text>
      <View className="flex-row gap-2">
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                if (isSelected && !clearable) return;
                onChange(isSelected ? null : option.value);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              className="flex-1 items-center rounded-xl border-2 py-3"
              style={{
                borderColor: isSelected ? colors.primary : colors.border,
                backgroundColor: isSelected ? colors.primary : 'transparent',
              }}>
              <Text
                className="font-semibold"
                style={{
                  fontSize: 14,
                  color: isSelected ? '#FFFFFF' : colors['text-secondary'],
                }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
