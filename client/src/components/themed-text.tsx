/**
 * Text that respects the user's colour scheme *and* their font-size setting.
 *
 * The second half is why this file changed. `ThemedText` shipped with fixed
 * `StyleSheet` sizes, so a screen that adopted it silently opted out of the
 * font-size preference — the opposite of what a shared text component is for,
 * and a regression waiting for whoever converted a screen to it. Sizes now
 * come from the variant and are scaled here, once, so a caller cannot forget.
 *
 * The OS accessibility scale is compensated for in `useFontScale()` rather
 * than here, so every component applying its own literals gets the same
 * treatment — see that file for why the two settings must not compound.
 *
 * ## Sizing lives in the variant, not at the call site
 *
 * `className` is forwarded for layout, spacing, and alignment. It is **not**
 * the place for `text-sm` / `text-lg`: those emit a fixed `fontSize` into the
 * same style object as the scaled one, making "which wins" a question of
 * ordering rather than of intent. The variant is the only sizing input.
 * Something that needs a size no variant offers wants a new variant — or is
 * telling you the app finally needs a real typography scale.
 */
import { Text, type TextProps } from 'react-native';

import { Fonts } from '@/constants/theme';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/cn';
import type { SemanticColorName } from '@/theme';

export type ThemedTextType =
  | 'default'
  | 'title'
  | 'subtitle'
  | 'label'
  | 'small'
  | 'smallBold'
  | 'link'
  | 'code';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  themeColor?: SemanticColorName;
  className?: string;
};

type Variant = {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  fontFamily?: string;
};

/**
 * Base sizes in px, before the preference and before the OS scale.
 *
 * `default` is 16 because that is the baseline `useFontScale()` is defined
 * against, so it renders at exactly the px the setup screen previews.
 *
 * The old `linkPrimary` variant is gone. It had no callers and its only
 * distinction was a hardcoded `#3c87f7`, which is the one thing this project
 * does not allow in a component — colour comes from `themeColor`, so
 * `<ThemedText type="link" themeColor="primary" />` is what it should have
 * been.
 */
const VARIANTS: Record<ThemedTextType, Variant> = {
  default: { fontSize: 16, lineHeight: 24, fontWeight: '500' },
  title: { fontSize: 48, lineHeight: 52, fontWeight: '600' },
  subtitle: { fontSize: 32, lineHeight: 44, fontWeight: '600' },
  // Section labels — the "ให้สิทธิ์" / "แหล่งข้อมูล" line above a group. Its
  // own step because 13 sits between `small` and nothing, and rounding it up
  // to 14 would flatten the hierarchy every settings-shaped screen relies on.
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  small: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  link: { fontSize: 14, lineHeight: 30, fontWeight: '500' },
  code: { fontSize: 12, lineHeight: 18, fontWeight: '700', fontFamily: Fonts.notoSans },
};

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  className,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  // Already OS-compensated — see `use-font-scale.ts`.
  const scale = useFontScale();

  const variant = VARIANTS[type];

  return (
    <Text
      className={cn(className)}
      style={[
        {
          color: theme[themeColor ?? 'text-primary'],
          fontSize: Math.round(variant.fontSize * scale),
          lineHeight: Math.round(variant.lineHeight * scale),
          fontWeight: variant.fontWeight,
          ...(variant.fontFamily ? { fontFamily: variant.fontFamily } : {}),
        },
        style,
      ]}
      {...rest}
    />
  );
}
