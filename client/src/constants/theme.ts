/**
 * Non-colour design constants: typography, spacing, and layout.
 *
 * Colours deliberately do not live here — they belong to src/theme/tokens.js,
 * the single source shared by NativeWind, Tamagui, and React Navigation.
 * Use `useTheme()` for resolved colours, or a `bg-*` / `text-*` utility.
 *
 * This file used to `import '@/global.css'`. It was redundant —
 * `app/_layout.tsx` imports it at the app root, which is the only place a
 * stylesheet side-effect belongs — and it made a constants module drag the
 * Tailwind entrypoint behind it. Under jest that import is handed to the JS
 * parser, which dies on `@tailwind base`, so every screen test reaching the
 * tab bar failed to load. Don't add it back; add it to a root layout if a new
 * entrypoint ever needs one.
 */

import { Platform } from 'react-native';

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/**
 * The app's typeface, one family name per weight.
 *
 * **Weight selects the family — it is not a `fontWeight`.** On Android an
 * explicit `fontFamily` does not synthesise weight: a `fontWeight: '700'` next
 * to `NotoSansThai_400Regular` is ignored or faked, which is exactly what the
 * two places that used this font were doing before. `ThemedText` maps its
 * `weight` prop through this record so the right file is chosen.
 *
 * Every entry must be loaded in `app/_layout.tsx`. A name that was never
 * loaded does not fail loudly — it silently falls back to the system font,
 * which on Android is a different Thai face per OEM and the whole reason this
 * app bundles one.
 *
 * Platform-independent on purpose: these are file names registered by
 * `useFonts`, not system aliases, so iOS and Android resolve the same string.
 * Web adds a `sans-serif` fallback for the window before the webfont lands.
 */
export const ThaiFontFamily = {
  regular: 'NotoSansThai_400Regular',
  medium: 'NotoSansThai_500Medium',
  semibold: 'NotoSansThai_600SemiBold',
  bold: 'NotoSansThai_700Bold',
} as const;

export type ThaiFontWeight = keyof typeof ThaiFontFamily;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;