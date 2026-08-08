/**
 * Wrapping chip grid for the seven relationship values.
 *
 * Not `components/ui/option-row.tsx`: that lays its options out as `flex-1`
 * siblings on one row, which is right for three (gender) and unreadable for
 * seven — each chip would be about four characters wide. This wraps instead,
 * and drops the `clearable` behaviour because the field is required.
 */
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

import { RELATIONSHIP_OPTIONS, relationshipLabel } from '../lib/relationship';
import type { RelationshipType } from '../types';

export type RelationshipPickerProps = {
  label: string;
  value: RelationshipType;
  onChange: (value: RelationshipType) => void;
  disabled?: boolean;
};

export function RelationshipPicker({
  label,
  value,
  onChange,
  disabled = false,
}: RelationshipPickerProps) {
  const colors = useTheme();

  return (
    <View className="mb-4" accessibilityRole="radiogroup" accessibilityLabel={label}>
      <ThemedText type="label" themeColor="text-secondary" className="mb-2 ml-1">
        {label}
      </ThemedText>

      <View className="flex-row flex-wrap gap-2">
        {RELATIONSHIP_OPTIONS.map((option) => {
          const isSelected = option === value;

          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled }}
              testID={`relationship-${option}`}
              // 44dp floor: these are chips, but the audience is elderly-first
              // and a chip is still a tap target.
              className="items-center justify-center rounded-xl border-2 px-4"
              style={{
                minHeight: 44,
                opacity: disabled ? 0.5 : 1,
                borderColor: isSelected ? colors.primary : colors['border-strong'],
                backgroundColor: isSelected ? colors.primary : 'transparent',
              }}
            >
              <ThemedText
                type="body"
                weight="semibold"
                themeColor="text-secondary"
                // White is the contrast pair for the filled background, not a
                // token of its own — `style` wins over `themeColor`.
                style={isSelected ? { color: '#FFFFFF' } : undefined}
              >
                {relationshipLabel(option)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
