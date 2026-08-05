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

    // 🟢 Noto Sans Thai
    notoSans: 'NotoSansThai_400Regular',
    notoSansBold: 'NotoSansThai_700Bold',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',

    // 🟢 Noto Sans Thai
    notoSans: 'NotoSansThai_400Regular',
    notoSansBold: 'NotoSansThai_700Bold',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',

    // 🟢 ใส่ fallback สำหรับ web
    notoSans: 'NotoSansThai_400Regular, sans-serif',
    notoSansBold: 'NotoSansThai_700Bold, sans-serif',
  },
});

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