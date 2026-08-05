/**
 * One row on the menu screen — ported faithfully from
 * client-old/components/menu-item.tsx: its own elevated card (not a shared
 * grouped-list container), a gradient icon badge, a circular chevron badge.
 * `MenuSection` is just the uppercase caption above a run of these, same as
 * client-old's `FadeInView`-wrapped groups (that wrapper animates nothing —
 * see the note in menu.tsx — so only the caption + spacing is ported).
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { palette } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export type MenuItemProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
  destructive?: boolean;
  testID?: string;
};

/** Icon badge gradient — client-old's literal `['#7E57C2', '#5E35B1']`, now off the token file. */
const ICON_BADGE_GRADIENT = [palette.purple, palette.purpleDark] as const;

export function MenuItem({
  icon,
  title,
  onPress,
  destructive = false,
  testID,
}: MenuItemProps) {
  const colors = useTheme();
  const { scheme } = useColorSchemePreference();
  const isDark = scheme === 'dark';

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      className="mb-2.5 flex-row items-center overflow-hidden rounded-2xl border p-3.5"
      style={{
        backgroundColor: destructive
          ? isDark
            ? '#2A0A0A'
            : '#FFF2F2'
          : colors.surface,
        borderColor: destructive
          ? isDark
            ? '#7F1D1D'
            : '#FECACA'
          : colors.border,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: isDark ? 0 : 0.06,
        shadowRadius: 6,
        elevation: isDark ? 0 : 2,
      }}
    >
      <View
        className="h-[42px] w-[42px] items-center justify-center overflow-hidden rounded-xl"
        style={{
          backgroundColor: destructive
            ? isDark
              ? '#2A0A0A'
              : '#FEE2E2'
            : undefined,
        }}
      >
        {destructive ? (
          <Ionicons name={icon} size={22} color={colors.danger} />
        ) : (
          <LinearGradient
            colors={ICON_BADGE_GRADIENT}
            className="h-full w-full items-center justify-center rounded-xl"
          >
            <Ionicons name={icon} size={20} color="#FFFFFF" />
          </LinearGradient>
        )}
      </View>

      <ThemedText type="body" weight="semibold" className="ml-3.5 flex-1 pr-2" style={{ color: destructive ? colors.danger : colors['text-primary'] }}>
        {title}
      </ThemedText>

      <View
        className="h-7 w-7 items-center justify-center rounded-full"
        style={{ backgroundColor: isDark ? '#1F2937' : '#F4F1F8' }}
      >
        <Ionicons
          name="chevron-forward"
          size={20}
          color={
            destructive ? colors.danger : isDark ? '#94A3B8' : palette.purple
          }
        />
      </View>
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

  return (
    <View className="mb-2 mt-6">
      {title ? (
        <ThemedText type="caption" weight="semibold" themeColor="text-secondary" className="mb-3 ml-1 uppercase" style={{ letterSpacing: 0.5 }}>
          {title}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}
