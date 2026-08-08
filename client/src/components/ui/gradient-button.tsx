/**
 * Primary action button — gradient fill, loading state, disabled state.
 *
 * Ported from client-old/components/custom-button.tsx, trimmed to the
 * variants actually in use and repointed at the gradient tokens. The old file
 * carried its own hex ladders per variant; those are now `accent`, `header`,
 * and `danger` in src/theme/tokens.js.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { gradientFor, type GradientName } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export type GradientButtonVariant = 'primary' | 'secondary' | 'danger';
export type GradientButtonSize = 'small' | 'medium' | 'large';

const VARIANT_GRADIENT: Record<GradientButtonVariant, GradientName> = {
  primary: 'accent',
  secondary: 'header',
  danger: 'danger',
};

const DISABLED_GRADIENT = ['#BDC3C7', '#BDC3C7'] as const;

const SIZE_CLASS: Record<GradientButtonSize, string> = {
  small: 'py-[10px] px-[18px]',
  medium: 'py-4 px-7',
  large: 'py-[18px] px-8',
};

/*
 * The label size belongs to the *button* size, not to a typography role, so
 * these stay here rather than becoming `ThemedText` variants — a shared text
 * component gaining `button-small` / `button-medium` steps would be the tail
 * wagging the dog. They are passed to `ThemedText`'s `size` prop, so they go
 * through `useTypography()` like everything else and a button label tracks the
 * user's size *and* family preference exactly like the prose around it.
 */
const SIZE_FONT: Record<GradientButtonSize, number> = {
  small: 14,
  medium: 15,
  large: 17,
};

export type GradientButtonProps = {
  title: string;
  onPress: () => void;
  variant?: GradientButtonVariant;
  size?: GradientButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  testID?: string;
};

export function GradientButton({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  icon,
  testID,
}: GradientButtonProps) {
  const { scheme } = useColorSchemePreference();
  // A press while loading would fire a second mutation against the same
  // form — the spinner is feedback, not a guard.
  const isBlocked = disabled || loading;
  const colors = isBlocked
    ? (DISABLED_GRADIENT as unknown as readonly [string, string, ...string[]])
    : gradientFor(scheme, VARIANT_GRADIENT[variant]);

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={isBlocked}
      accessibilityRole="button"
      accessibilityState={{ disabled: isBlocked, busy: loading }}
      style={({ pressed }) => ({ opacity: pressed && !isBlocked ? 0.85 : 1 })}>
      <LinearGradient
        colors={colors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className={`flex-row items-center justify-center rounded-2xl ${SIZE_CLASS[size]}`}>
        {loading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            {icon ? <View className="mr-2">{icon}</View> : null}
            <ThemedText size={SIZE_FONT[size]} weight="bold" numberOfLines={1} style={{ color: '#FFFFFF' }}>
              {title}
            </ThemedText>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}
