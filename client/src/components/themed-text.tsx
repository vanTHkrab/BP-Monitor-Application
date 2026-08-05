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

import { ThaiFontFamily, type ThaiFontWeight } from '@/constants/theme';
import { useFontScale } from '@/hooks/use-font-scale';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/cn';
import type { SemanticColorName } from '@/theme';

export type ThemedTextType =
  | 'display'
  | 'title'
  | 'heading'
  | 'bodyLarge'
  | 'body'
  | 'default'
  | 'small'
  | 'smallBold'
  | 'label'
  | 'caption'
  | 'link'
  | 'code';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  themeColor?: SemanticColorName;
  /** Overrides the variant's default weight. Selects a font file, not a `fontWeight`. */
  weight?: ThaiFontWeight;
  className?: string;
};

type Variant = {
  fontSize: number;
  lineHeight: number;
  weight: ThaiFontWeight;
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
  display: { fontSize: 44, lineHeight: 52, weight: 'bold' },
  title: { fontSize: 24, lineHeight: 32, weight: 'bold' },
  heading: { fontSize: 20, lineHeight: 28, weight: 'semibold' },
  bodyLarge: { fontSize: 17, lineHeight: 25, weight: 'medium' },
  default: { fontSize: 16, lineHeight: 24, weight: 'medium' },
  body: { fontSize: 15, lineHeight: 22, weight: 'medium' },
  small: { fontSize: 14, lineHeight: 20, weight: 'medium' },
  smallBold: { fontSize: 14, lineHeight: 20, weight: 'bold' },
  label: { fontSize: 13, lineHeight: 19, weight: 'semibold' },
  caption: { fontSize: 12, lineHeight: 18, weight: 'regular' },
  link: { fontSize: 14, lineHeight: 20, weight: 'medium' },
  code: { fontSize: 12, lineHeight: 18, weight: 'bold' },
};

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  weight,
  className,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  // Already OS-compensated — see `use-font-scale.ts`.
  const scale = useFontScale();

  const variant = VARIANTS[type];
  const family = ThaiFontFamily[weight ?? variant.weight];

  return (
    <Text
      className={cn(className)}
      style={[
        {
          color: theme[themeColor ?? 'text-primary'],
          fontSize: Math.round(variant.fontSize * scale),
          lineHeight: Math.round(variant.lineHeight * scale),
          // No `fontWeight`. On Android it is ignored or faked next to an
          // explicit family, and emitting one invites a caller to think
          // `className="font-bold"` will work here — it will not. `weight`
          // is the axis.
          fontFamily: family,
        },
        style,
      ]}
      {...rest}
    />
  );
}
