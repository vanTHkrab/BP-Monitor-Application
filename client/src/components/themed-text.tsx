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
 * `className` is forwarded for layout, spacing, and alignment only.
 *
 * **Colour and size utilities do not work here, and fail silently.** This
 * component's own style object is applied after NativeWind's, so a
 * `text-white` is simply dropped — a sweep of the app found thirteen nodes
 * that would have rendered dark text on a gradient. Colour goes through
 * `themeColor`, or through `style` for a value that is not a token (white on
 * a filled surface, a BP-severity tint). Size goes through `type`, or through
 * `size` when the scale genuinely does not name it.
 *
 * `text-[15px]` is worse than dropped — it *works*, and never scales, because
 * a Tailwind arbitrary value is a fixed px. Nine nodes in the app were quietly
 * ignoring the font-size preference that way before the sweep.
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
  /**
   * An explicit px size, scaled like a variant's. **Prefer a variant.**
   *
   * This exists for text whose size is genuinely a property of its component
   * rather than a typography role: a button's `small`/`medium`/`large`, the
   * blood-pressure figure that is 48 on the hero card and 38 in a list row, a
   * chart label pinned to an axis prop. Minting a variant for each would put
   * one component's composition into a shared scale.
   *
   * It is also the inventory. `grep 'size={'` lists every size the scale does
   * not name — which is the input to designing a real one, and the reason
   * this is a visible prop rather than a `style` override that would silently
   * stop scaling.
   */
  size?: number;
  /** Explicit px line height, scaled. Defaults to `size × 1.45`. */
  lineHeight?: number;
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
 * Line heights sit at roughly 1.45–1.5× on purpose. Thai stacks diacritics two
 * levels (สระบน plus วรรณยุกต์), so the ratio that reads as generous in Latin
 * is merely adequate here. `small` and `link` were the outliers at 1.43 and
 * are now 21 — a paragraph in `guidance-card` had independently reached for
 * 22 at the same size, which is the same observation arrived at by eye.
 *
 * **A `lineHeight` or `fontSize` passed through `style` is NOT scaled.** The
 * variant's numbers go through the multiplier; a literal in `style` does not,
 * so it silently stops tracking the user's preference. That is the second
 * reason sizing belongs to the variant and not to the call site.
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
  small: { fontSize: 14, lineHeight: 21, weight: 'medium' },
  smallBold: { fontSize: 14, lineHeight: 21, weight: 'bold' },
  label: { fontSize: 13, lineHeight: 19, weight: 'semibold' },
  caption: { fontSize: 12, lineHeight: 18, weight: 'regular' },
  link: { fontSize: 14, lineHeight: 21, weight: 'medium' },
  code: { fontSize: 12, lineHeight: 18, weight: 'bold' },
};

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  weight,
  size,
  lineHeight,
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
          fontSize: Math.round((size ?? variant.fontSize) * scale),
          lineHeight: Math.round(
            (lineHeight ?? (size ? size * 1.45 : variant.lineHeight)) * scale,
          ),
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
