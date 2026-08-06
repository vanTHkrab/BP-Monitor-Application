/**
 * Typed access to the design tokens for the consumers that cannot read
 * Tailwind utilities: gradients (expo-linear-gradient) and React Navigation.
 *
 * Tailwind/NativeWind and Tamagui both read the same tokens.js, so anything
 * exported here is guaranteed to match `bg-surface` and Tamagui's `$surface`.
 */
// expo-router 57 vendors React Navigation, so the themes come from there —
// @react-navigation/native is not a direct dependency of this app.
import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';

import {
  gradients,
  palette,
  semantic,
  status,
  type ColorSchemeName,
  type GradientName,
  type SemanticColorName,
} from './tokens';

export type { ColorSchemeName, GradientName, SemanticColorName };
export { palette, status };

/** Semantic colours resolved for one mode. */
export function colorsFor(scheme: ColorSchemeName): Record<SemanticColorName, string> {
  return semantic[scheme];
}

/** Gradient stops for one mode, ready to hand to expo-linear-gradient. */
export function gradientFor(
  scheme: ColorSchemeName,
  name: GradientName,
): readonly [string, string, ...string[]] {
  return gradients[scheme][name];
}

/**
 * React Navigation owns the screen background, header, and tab bar chrome.
 * It reads plain colour values, not CSS variables, so it needs its own
 * theme object built from the same tokens.
 */
export function navigationThemeFor(scheme: ColorSchemeName): Theme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const colors = semantic[scheme];

  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors['text-primary'],
      border: colors.border,
      notification: colors.danger,
    },
  };
}
