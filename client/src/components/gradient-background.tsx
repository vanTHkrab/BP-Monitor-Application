/**
 * Full-bleed screen background, ported from client-old.
 *
 * The stops come from the `background` gradient token rather than the hex
 * literals the old file carried, so this follows the same source of truth as
 * `bg-background` in Tailwind.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { cssInterop } from 'nativewind';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { gradientFor } from '@/theme';
import { useColorSchemePreference } from '@/theme/color-scheme';

cssInterop(LinearGradient, { className: 'style' });

export type GradientBackgroundProps = {
  children: ReactNode;
  /** Off when the screen manages its own insets, e.g. a full-bleed camera. */
  safeArea?: boolean;
};

export function GradientBackground({ children, safeArea = true }: GradientBackgroundProps) {
  const { scheme } = useColorSchemePreference();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={gradientFor(scheme, 'background')}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      className="flex-1">
      <View
        className="flex-1"
        style={
          safeArea
            ? {
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
                paddingLeft: insets.left,
                paddingRight: insets.right,
              }
            : undefined
        }>
        {children}
      </View>
    </LinearGradient>
  );
}
