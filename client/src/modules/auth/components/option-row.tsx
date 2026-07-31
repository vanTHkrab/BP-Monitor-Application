/**
 * Single-choice row of pills, used for gender on the register form.
 *
 * A row of buttons rather than a native picker: three options fit on one
 * line, and a picker costs a modal round trip for a choice the user can make
 * in one tap. `null` is a real value here — gender is optional.
 */
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export type OptionRowItem<T extends string> = { value: T; label: string };

export type OptionRowProps<T extends string> = {
  label: string;
  options: readonly OptionRowItem<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
};

export function OptionRow<T extends string>({
  label,
  options,
  value,
  onChange,
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
              // Tapping the selected option clears it — otherwise an optional
              // field becomes permanent after one accidental tap.
              onPress={() => onChange(isSelected ? null : option.value)}
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
