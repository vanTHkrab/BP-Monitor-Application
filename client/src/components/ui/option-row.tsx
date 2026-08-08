/**
 * Single-choice row of pills.
 *
 * Moved out of `modules/auth/components/` because nothing about it is
 * auth-specific. It briefly also served theme and font size on
 * `app/settings.tsx`; both now use purpose-built pickers
 * (`theme-picker.tsx`, `font-size-picker.tsx`) because those two settings
 * are better shown than labelled — a theme wants an icon, and a font size
 * wants a sample at that size. Gender on the register form is the remaining
 * consumer, and a row of words is right for it.
 */
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
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
      <ThemedText type="label" themeColor="text-secondary" className="mb-2 ml-1">
        {label}
      </ThemedText>
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
                borderColor: isSelected ? colors.primary : colors['border-strong'],
                backgroundColor: isSelected ? colors.primary : 'transparent',
              }}>
              <ThemedText
                type="body"
                weight="bold"
                themeColor="text-secondary"
                // White on the filled state is not a semantic token — the
                // token is the *background*, and this is the contrast pair
                // for it. `style` lands after `themeColor`, so it wins.
                style={isSelected ? { color: '#FFFFFF' } : undefined}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
