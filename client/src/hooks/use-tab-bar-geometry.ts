/**
 * The bottom tab bar's measurements, in one place.
 *
 * `app/(tabs)/_layout.tsx` styles the bar from these; `app/(tabs)/camera.tsx`
 * uses `totalHeight` to keep its own bottom overlay clear of it. The camera
 * used to carry a copy of the arithmetic under a comment reading *"Duplicated
 * rather than imported… if those numbers change there, change them here"* —
 * and then the numbers changed there and this did not, which is how a font
 * preference silently ate 4px of the overlay's 14px clearance. A comment
 * asking two files to stay in step is a promise nobody can keep; a shared hook
 * is the version that holds.
 *
 * The bar is `position: 'absolute'`, so **nothing reserves this space**. Every
 * screen inside `(tabs)` has to pad its own scroll content past it.
 */
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  useLayoutTypography,
  useResolvedFontFamily,
  useTypography,
} from '@/hooks/use-typography';
import { FONT_FAMILIES } from '@/theme/typography';

/** Base px of the tab label, before the size preference and the optical scale. */
export const TAB_LABEL_SIZE = 11;

export type TabBarGeometry = {
  /** The bar's own `height`, inset and font headroom included. */
  height: number;
  paddingBottom: number;
  marginBottom: number;
  /** `height + marginBottom` — what a screen has to clear from the bottom edge. */
  totalHeight: number;
  /** The resolved label style, so the navigator and this stay on one answer. */
  labelStyle: ReturnType<ReturnType<typeof useTypography>>;
};

export function useTabBarGeometry(): TabBarGeometry {
  const insets = useSafeAreaInsets();
  const typography = useTypography();
  const layout = useLayoutTypography();
  // The family the label will *actually* render in — not the raw preference,
  // which differs while a deferred font is still loading.
  const family = useResolvedFontFamily();

  const labelSpec = { size: TAB_LABEL_SIZE, weight: 'bold', lineHeight: null } as const;

  /** What the navigator puts on the label — style units, OS scale divided out. */
  const labelStyle = typography(labelSpec);
  /** What that label occupies once RN multiplies the OS scale back in — dp. */
  const paintedLabel = layout(labelSpec);

  /*
   * How much taller this family's label box is than the one the bar was sized
   * for. Zero for Noto, so the default user's bar is exactly what it was.
   *
   * Measured against `naturalLineHeightRatio` — the OS/2 win box, which is
   * what Android reserves when text carries no explicit `lineHeight` — rather
   * than against the emitted line height, because the label deliberately
   * carries none. Without it, looped and Sarabun overflow a bar whose height
   * was fixed when Noto was the only face, and the bottom of every label is
   * cut off. Confirmed on hardware.
   *
   * **From `layout(…)`, not from `labelStyle`.** The bar's `height` is dp and
   * nothing scales it, while `labelStyle.fontSize` has the OS accessibility
   * scale divided out and is multiplied back at paint time. Sizing the bar
   * from the style number under-reserved by exactly that factor, so the
   * headroom shrank as the *system* font size grew — disabling the clipping
   * fix for the users most likely to have raised it, and most likely to have
   * chosen the looped face for the same reason. See `useLayoutTypography`.
   */
  const labelHeadroom = Math.ceil(
    (paintedLabel.fontSize ?? TAB_LABEL_SIZE) *
      Math.max(
        0,
        FONT_FAMILIES[family].naturalLineHeightRatio -
          FONT_FAMILIES.noto.naturalLineHeightRatio,
      ),
  );

  const baseHeight = Platform.OS === 'ios' ? 60 : 62;
  const marginBottom = Platform.OS === 'ios' ? 2 : 4;
  const height = baseHeight + insets.bottom + labelHeadroom;

  return {
    height,
    paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 12 : 10),
    marginBottom,
    totalHeight: height + marginBottom,
    labelStyle,
  };
}
