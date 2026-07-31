/**
 * One setting, as a card. Ported from the `SettingItem` defined inside
 * client-old/app/settings.tsx.
 *
 * Deliberately *not* reusing `modules/security`'s `SecurityRow`, even though
 * the two look similar in a screenshot. Security was a restructure — grouped
 * rows inside one surface, because that screen gained four sub-screens and
 * needed to read as a settings index. Settings is a fidelity port, and
 * client-old's settings screen is individually-carded rows with a sky-tinted
 * border. Making them share a component would silently redesign one of the two.
 *
 * Lifted out of the screen file (client-old kept it inline) because the
 * notification and export sections still to come use the same row, and a
 * component redefined on every render of a 900-line screen remounts its
 * subtree on every keystroke elsewhere on the page.
 */
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Switch, Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { palette } from '@/theme';

export type SettingItemProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** Present only for a toggle row. Omit for a plain or tappable row. */
  value?: boolean;
  onValueChange?: (value: boolean) => void;
  /** Makes the whole card tappable. Mutually exclusive with a switch in practice. */
  onPress?: () => void;
  /** Tints the icon badge. Defaults to the blue used by most rows. */
  accent?: 'blue' | 'purple';
  disabled?: boolean;
  testID?: string;
};

export function SettingItem({
  icon,
  title,
  subtitle,
  value,
  onValueChange,
  onPress,
  accent = 'blue',
  disabled = false,
  testID,
}: SettingItemProps) {
  const colors = useTheme();
  const fontScale = useFontScale();

  const accentColor = accent === 'purple' ? palette.purple : palette.blue;
  const hasSwitch = typeof value === 'boolean' && Boolean(onValueChange);

  const body = (
    <View
      className="mb-3 flex-row items-center rounded-xl border p-4"
      style={{
        backgroundColor: colors.surface,
        borderColor: colors.border,
        // 64dp even without a switch: the elderly-first floor applies to
        // every tappable row, and a card that changes height depending on
        // whether it has a toggle makes the list read as ragged.
        minHeight: 64,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <View
        className="mr-3 h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: colors['surface-muted'] }}
      >
        <Ionicons name={icon} size={22} color={accentColor} />
      </View>

      <View className="flex-1 pr-3">
        <Text
          className="font-medium"
          style={{ fontSize: Math.round(16 * fontScale), color: colors['text-primary'] }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="mt-0.5"
            style={{
              fontSize: Math.round(13 * fontScale),
              lineHeight: Math.round(19 * fontScale),
              color: colors['text-secondary'],
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {hasSwitch ? (
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: colors.border, true: palette.blueSky }}
          thumbColor={value ? palette.blue : '#F4F3F4'}
          accessibilityLabel={title}
        />
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={20} color={colors['text-secondary']} />
      ) : null}
    </View>
  );

  if (!onPress) return <View testID={testID}>{body}</View>;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ disabled }}
    >
      {body}
    </Pressable>
  );
}

/** The bold label above a run of cards. client-old repeated this markup inline. */
export function SettingSection({ title }: { title: string }) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <Text
      className="mb-3 mt-4 font-bold"
      style={{ fontSize: Math.round(17 * fontScale), color: colors['text-primary'] }}
    >
      {title}
    </Text>
  );
}
