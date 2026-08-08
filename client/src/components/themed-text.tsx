/**
 * Text that respects the user's colour scheme *and* their typography settings.
 *
 * The second half is why this file changed. `ThemedText` shipped with fixed
 * `StyleSheet` sizes, so a screen that adopted it silently opted out of the
 * font-size preference — the opposite of what a shared text component is for,
 * and a regression waiting for whoever converted a screen to it.
 *
 * It no longer owns any of those numbers. The role table lives in
 * `theme/typography.ts` as `TYPE_SCALE`, and the arithmetic lives in
 * `hooks/use-typography.ts`. This component is now one caller of that resolver
 * among several — the chart, the four text inputs, and the six deliberately
 * raw `<Text>` nodes are the others, and none of them could have consumed a
 * component. Keeping the maths here would have left every one of them with its
 * own copy, which is exactly how the font-*family* preference would have
 * arrived applying to some text and not the rest.
 *
 * The OS accessibility scale is compensated for in `useFontScale()`, which the
 * resolver reads — see that file for why the two settings must not compound.
 *
 * ## Sizing and typeface live in the props, not at the call site
 *
 * `className` is forwarded for layout, spacing, and alignment only.
 *
 * **Colour, size, and font-family utilities do not work here, and fail
 * silently.** This component's own style object is applied after NativeWind's,
 * so a `text-white` is simply dropped — a sweep of the app found thirteen
 * nodes that would have rendered dark text on a gradient. Colour goes through
 * `themeColor`, or through `style` for a value that is not a token (white on a
 * filled surface, a BP-severity tint). Size goes through `type`, or through
 * `size` when the scale genuinely does not name it. A `font-*` class naming a
 * family is dropped the same way, and `family` is the axis for that.
 *
 * `text-[15px]` is worse than dropped — it *works*, and never scales, because
 * a Tailwind arbitrary value is a fixed px. Nine nodes in the app were quietly
 * ignoring the font-size preference that way before the sweep.
 */
import { Text, type TextProps } from 'react-native';

import { type ThaiFontWeight } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useTypography } from '@/hooks/use-typography';
import { cn } from '@/lib/cn';
import type { SemanticColorName } from '@/theme';
import type { FontFamilyId, TypeRole } from '@/theme/typography';

/** @deprecated Prefer `TypeRole` from `@/theme/typography` — same twelve roles. */
export type ThemedTextType = TypeRole;

export type ThemedTextProps = TextProps & {
  type?: TypeRole;
  themeColor?: SemanticColorName;
  /** Overrides the role's default weight. Selects a font file, not a `fontWeight`. */
  weight?: ThaiFontWeight;
  /**
   * Overrides the user's font-family preference for this node.
   *
   * **Almost nothing should pass this.** The preference is the user's answer
   * to "what is easiest for me to read", and a component overriding it is
   * overruling that. The one standing exception is `family="mono"`, which the
   * blood-pressure figure uses so `120/80` occupies the same width in the home
   * hero card, a history row, and the detail screen — proportional digits make
   * a column of readings jitter, and comparing them down that column is what
   * those screens are for.
   *
   * `mono` is Latin-only. Never put Thai text in it: the glyphs are not there,
   * and the fallback is the OEM system face rather than anything the app
   * chose.
   */
  family?: FontFamilyId;
  /**
   * An explicit px size, scaled like a role's. **Prefer a role.**
   *
   * This exists for text whose size is genuinely a property of its component
   * rather than a typography role: a button's `small`/`medium`/`large`, the
   * blood-pressure figure that is 48 on the hero card and 38 in a list row, a
   * chart label pinned to an axis prop. Minting a role for each would put one
   * component's composition into a shared scale.
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

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  weight,
  family,
  size,
  lineHeight,
  className,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  const typography = useTypography();

  return (
    <Text
      className={cn(className)}
      style={[
        {
          color: theme[themeColor ?? 'text-primary'],
          ...typography({ type, size, lineHeight, weight, family }),
        },
        style,
      ]}
      {...rest}
    />
  );
}
