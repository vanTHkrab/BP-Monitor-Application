import { defaultConfig } from '@tamagui/config/v5';
import { createTamagui } from 'tamagui';

import { palette, semantic, status } from './src/theme/tokens';

/**
 * Tamagui styles the primitives under src/components/ui/; NativeWind styles
 * screen layout under src/app/. Both read src/theme/tokens.js, so `$surface`
 * here and `bg-surface` there resolve to the same colour.
 *
 * Only the palette is overridden — spacing, sizing, radius, and animations
 * stay on Tamagui's v5 defaults.
 */
const themeFor = (scheme: 'light' | 'dark') => ({
  ...semantic[scheme],
  ...status,
  // Tamagui's own primitives look for these names.
  background: semantic[scheme].background,
  color: semantic[scheme]['text-primary'],
  borderColor: semantic[scheme].border,
});

export const tamaguiConfig = createTamagui({
  ...defaultConfig,
  // Tamagui v5's defaultConfig ships no `color` token group, so this adds
  // one rather than extending it.
  tokens: {
    ...defaultConfig.tokens,
    color: { ...palette, ...status },
  },
  themes: {
    ...defaultConfig.themes,
    light: { ...defaultConfig.themes.light, ...themeFor('light') },
    dark: { ...defaultConfig.themes.dark, ...themeFor('dark') },
  },
});

export default tamaguiConfig;

export type Conf = typeof tamaguiConfig;

declare module 'tamagui' {
  interface TamaguiCustomConfig extends Conf {}
}
