/**
 * Wrapping chip grid for the seven relationship values.
 *
 * Not `components/ui/option-row.tsx`: that lays its options out as `flex-1`
 * siblings on one row, which is right for three (gender) and unreadable for
 * seven — each chip would be about four characters wide. This wraps instead,
 * and drops the `clearable` behaviour because the field is required.
 */
import { Pressable, Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
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
  const fontScale = useFontScale();

  return (
    <View className="mb-4" accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text
        className="mb-2 ml-1 font-semibold"
        style={{ fontSize: Math.round(13 * fontScale), color: colors['text-secondary'] }}
      >
        {label}
      </Text>

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
                borderColor: isSelected ? colors.primary : colors.border,
                backgroundColor: isSelected ? colors.primary : 'transparent',
              }}
            >
              <Text
                className="font-semibold"
                style={{
                  fontSize: Math.round(14 * fontScale),
                  color: isSelected ? '#FFFFFF' : colors['text-secondary'],
                }}
              >
                {relationshipLabel(option)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
