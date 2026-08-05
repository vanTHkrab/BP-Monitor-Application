import { defaultConfig } from '@tamagui/config/v5';
import { animations } from '@tamagui/config/v5-rn';
import { createTamagui } from 'tamagui';

import { palette, semantic, status } from './src/theme/tokens';

/**
 * Tamagui styles the primitives under src/components/ui/; NativeWind styles
 * screen layout under src/app/. Both read src/theme/tokens.js, so `$surface`
 * here and `bg-surface` there resolve to the same colour.
 *
 * Only the palette is overridden — spacing, sizing, and radius stay on
 * Tamagui's v5 defaults.
 *
 * **Animations are added explicitly.** `@tamagui/config/v5` deliberately
 * ships none ("users import from specific paths"), and without them the
 * `transition` prop does not exist: a `Sheet` snaps open and a `Toast`
 * appears instantly, with a type error as the only clue. The React Native
 * (`Animated`) driver rather than the Reanimated one — the app's Reanimated
 * is stubbed under jest (`jest.setup.js`), and routing Tamagui through that
 * stub would make every animated component untestable to buy motion nothing
 * here needs on the UI thread.
 *
 * Two renames in Tamagui v2 that make every v1 example found online fail to
 * compile, both worth knowing before writing a component here:
 *
 *   - **Style props are Tailwind-style**: `bg` / `p` / `px` / `py` / `items`
 *     / `justify` / `rounded` / `shrink`, not `backgroundColor` /
 *     `padding` / `alignItems`. The React Native long names are rejected and
 *     the error suggests an unrelated near-match ("Did you mean
 *     'background'?"), which reads like a typo rather than an API change.
 *   - **`animation` is now `transition`.** `animation` is simply not a prop,
 *     so the error is "Property 'animation' does not exist" — identical to
 *     what a missing animation driver produces, which is a misleading trail.
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
  animations,
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
