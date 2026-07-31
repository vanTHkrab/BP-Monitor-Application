/**
 * One row in a grouped settings/menu list — icon, title, optional subtitle,
 * chevron. Meant to sit inside `MenuSection`, not standalone: a native
 * grouped list (one rounded container, hairline dividers between rows)
 * reads calmer than N separately-bordered cards stacked with gaps, and
 * avoids repeating the same card shell for every row.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';

export type MenuItemProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  onPress: () => void;
  /** Hides the divider below — set on the last row in a section. */
  isLast?: boolean;
  destructive?: boolean;
  testID?: string;
};

export function MenuItem({
  icon,
  title,
  subtitle,
  onPress,
  isLast = false,
  destructive = false,
  testID,
}: MenuItemProps) {
  const colors = useTheme();
  const fontScale = useFontScale();
  const titleColor = destructive ? colors.danger : colors['text-primary'];

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="flex-row items-center px-4 py-3.5"
      style={({ pressed }) => ({
        backgroundColor: pressed ? colors['surface-muted'] : 'transparent',
        borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      })}
    >
      <View
        className="mr-3 h-9 w-9 items-center justify-center rounded-full"
        style={{ backgroundColor: colors['surface-muted'] }}
      >
        <Ionicons
          name={icon}
          size={19}
          color={destructive ? colors.danger : colors['text-secondary']}
        />
      </View>
      <View className="flex-1">
        <Text
          style={{
            fontSize: Math.round(15 * fontScale),
            color: titleColor,
            fontWeight: '500',
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            className="mt-0.5"
            style={{
              fontSize: Math.round(12 * fontScale),
              color: colors['text-secondary'],
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {!destructive ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors['text-secondary']}
        />
      ) : null}
    </Pressable>
  );
}

export function MenuSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const colors = useTheme();
  const fontScale = useFontScale();

  return (
    <View className="mb-6">
      {title ? (
        <Text
          className="mb-2 ml-1 font-semibold uppercase"
          style={{
            fontSize: Math.round(12 * fontScale),
            color: colors['text-secondary'],
            letterSpacing: 0.4,
          }}
        >
          {title}
        </Text>
      ) : null}
      <View
        className="overflow-hidden rounded-2xl border"
        style={{ backgroundColor: colors.surface, borderColor: colors.border }}
      >
        {children}
      </View>
    </View>
  );
}
