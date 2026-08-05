/**
 * A large, tappable card with a title and an explanation.
 *
 * Cards rather than a segmented control because the audience is
 * elderly-first and the choice is consequential: the description is what
 * makes "ผู้ป่วย" vs "ผู้ดูแล" a decision someone can actually make, and it
 * needs room to be read.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type ChoiceCardProps = {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
  testID?: string;
};

export function ChoiceCard({
  title,
  description,
  icon,
  selected,
  onPress,
  testID,
}: ChoiceCardProps) {
  const colors = useTheme();

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${description}`}
      className="mb-4 flex-row items-center rounded-2xl border-2 p-4"
      style={{
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? colors['surface-muted'] : colors.surface,
      }}>
      <View
        className="mr-4 h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: selected ? colors.primary : colors['surface-muted'] }}>
        <Ionicons name={icon} size={24} color={selected ? '#FFFFFF' : colors['text-secondary']} />
      </View>

      <View className="flex-1">
        <ThemedText type="bodyLarge" weight="bold">
          {title}
        </ThemedText>
        <ThemedText type="small" weight="regular" themeColor="text-secondary" className="mt-1">
          {description}
        </ThemedText>
      </View>

      {selected ? (
        <Ionicons name="checkmark-circle" size={24} color={colors.primary} />
      ) : null}
    </Pressable>
  );
}
