/**
 * The one place in the app that turns a base px into a rendered px.
 *
 * ## Why a style object and not a component
 *
 * `ThemedText` already exists and covers 319 of the app's ~330 text nodes.
 * This resolver is deliberately *not* a second component, because the callers
 * that were doing the arithmetic by hand cannot accept one:
 *
 *  - `bp-trend-chart.tsx` hands `yAxisTextStyle` / `textFontSize` to
 *    `react-native-gifted-charts`, which takes a style, not children.
 *  - Six raw `<Text>` nodes stay raw for reasons written down in
 *    `docs/project/CLIENT-typography.md` §4 — a font-size preview that must
 *    not scale with the current preference, a pointer label pinned one px
 *    above an axis prop, a body measured with `onTextLayout`.
 *  - Four `<TextInput>` fields, which `ThemedText` cannot wrap at all.
 *
 * A `TextStyle` merges into every one of those. A component would have forced
 * each of them to keep its own copy of the multiplication, which is the exact
 * drift this change exists to remove.
 *
 * ## The chain
 *
 * `Math.round(base × sizeScale × family.opticalScale)`, once, here. Both
 * multipliers land in the same expression on purpose: applied in two places
 * they round twice, and a family switch would visibly nudge every size by a px
 * in one direction or the other depending on which caller had been updated.
 *
 * After this change `Math.round(x * fontScale)` must not appear anywhere else
 * in `src/`.
 */
import { useCallback } from 'react';
import type { TextStyle } from 'react-native';

import type { ThaiFontWeight } from '@/constants/theme';
import { useFontScale } from '@/hooks/use-font-scale';
import { usePreferencesStore, type FontSizePreference } from '@/stores';
import { useLoadedFontFamilies } from '@/theme/font-loading';
import {
  BASELINE_PX,
  DEFAULT_LINE_HEIGHT_RATIO,
  FONT_FAMILIES,
  FONT_SIZE_STEPS,
  FALLBACK_MIN_LINE_HEIGHT_RATIO,
  TYPE_SCALE,
  type FontFamilyId,
  type TypeRole,
} from '@/theme/typography';

export type TextSpec = {
  type?: TypeRole;
  /** Base px; the resolver multiplies. */
  size?: number;
  /**
   * Base px; the resolver multiplies — and then **clamps up to
   * `MIN_LINE_HEIGHT_RATIO × fontSize`.** This is a floor, not an exact
   * value: ask for more leading and you get it, ask for less and you get the
   * floor plus a `__DEV__` warning naming the spec that was overruled.
   *
   * The floor is not a style opinion. Android sizes the line box at exactly
   * `lineHeight` and clamps the font's descent to fit, so Thai
   * below-baseline marks (◌ุ ◌ู, ฐ's foot) lose their bottom half below
   * ~1.45. `tab-buttons.tsx` shipped at 1.33 and clipped on hardware.
   *
   * **`null` means emit none**, and it is exempt from the clamp — the two are
   * separate branches. It exists for `<TextInput>`, where an explicit line
   * height mis-centres the caret and clips descenders on Android; the three
   * single-line fields that were doing `Math.round(15 * fontScale)` by hand
   * had no line height for exactly that reason, and silently acquiring one
   * during the migration would have been a layout regression dressed as a
   * refactor. The two multiline composers *do* want one and pass a number.
   */
  lineHeight?: number | null;
  weight?: ThaiFontWeight;
  /** Omitted = follow the user's preference. */
  family?: FontFamilyId;
};

export type TypographyPreferences = {
  fontSize: FontSizePreference;
  fontFamily: FontFamilyId;
};

/** A pure function cannot ask the device, so it assumes the best. See `typographyFor`. */
const ALL_FAMILIES: ReadonlySet<FontFamilyId> = new Set(
  Object.keys(FONT_FAMILIES) as FontFamilyId[],
);

/**
 * Maps a weight the app names onto a weight the family actually ships.
 *
 * Only `noto` carries all four (see `FONT_FAMILIES`), so `medium` and
 * `semibold` have to land somewhere on a two-weight face. They fall
 * **outward** — `medium → regular`, `semibold → bold` — rather than both
 * collapsing onto regular, because those two rungs are what the app uses to
 * separate a card's title from its subtitle. Collapsing them would flatten
 * that hierarchy on every settings-shaped and card-shaped screen; splitting
 * them keeps two visibly different faces where the design asked for two.
 *
 * A named helper rather than an inline `??` chain because it is the rule most
 * likely to be wrong for a family added later — a three-weight face wants a
 * different answer, and it should be changed in one readable place.
 */
export function resolveFamilyWeight(family: FontFamilyId, weight: ThaiFontWeight): string {
  const { weights } = FONT_FAMILIES[family];

  switch (weight) {
    case 'medium':
      return weights.medium ?? weights.regular ?? weights.bold ?? '';
    case 'semibold':
      return weights.semibold ?? weights.bold ?? weights.regular ?? '';
    case 'bold':
      return weights.bold ?? weights.semibold ?? weights.regular ?? '';
    case 'regular':
    default:
      return weights.regular ?? weights.medium ?? '';
  }
}

/**
 * Which family may actually be named, given what the device has loaded.
 *
 * An unloaded name is not an error the user sees — it is the OEM's own Thai
 * face appearing for a frame or a second, mid-paragraph. Falling back to
 * `noto` (which blocked the splash and is therefore always present) keeps the
 * app on its own typeface throughout, and the swap when the real family lands
 * is a re-render rather than a reload.
 */
function usableFamily(
  requested: FontFamilyId,
  loaded: ReadonlySet<FontFamilyId>,
): FontFamilyId {
  return loaded.has(requested) ? requested : 'noto';
}

function resolve(
  fontFamily: FontFamilyId,
  spec: TextSpec | undefined,
  loaded: ReadonlySet<FontFamilyId>,
  /** OS-accessibility-compensated when it came from the hook; plain when pure. */
  sizeScale: number,
): TextStyle {
  const role = TYPE_SCALE[spec?.type ?? 'default'];
  const family = usableFamily(spec?.family ?? fontFamily, loaded);
  const { opticalScale } = FONT_FAMILIES[family];

  const baseSize = spec?.size ?? role.fontSize;
  // `!== undefined` rather than `??`: `null` is a meaningful value here — it
  // means "emit no line height" — and `??` would treat it as absent and hand
  // back the role's default, which is the opposite instruction.
  const baseLineHeight =
    spec?.lineHeight !== undefined
      ? spec.lineHeight
      : spec?.size
        ? spec.size * DEFAULT_LINE_HEIGHT_RATIO
        : role.lineHeight;

  const scale = sizeScale * opticalScale;
  const fontSize = Math.round(baseSize * scale);

  /*
   * Where the line height came from, decided here rather than re-derived from
   * a ratio inside the clamp. Re-deriving it is a float trap: the `derived`
   * case is `size × 1.45`, and `26 * 1.45` is `37.699999999999996`, so
   * `baseLineHeight / baseSize < 1.45` reads *true* for a value that is 1.45
   * by construction — and the clamp then exempted the one path that is
   * defined to sit exactly on the floor.
   */
  const lineHeightSource: LineHeightSource =
    spec?.lineHeight !== undefined ? 'override' : spec?.size !== undefined ? 'derived' : 'role';

  return {
    fontSize,
    // `null` means emit nothing at all, and it must not interact with the
    // clamp — a `<TextInput>` that asked for no line height must still get
    // none, or the caret re-centres. Separate branches for that reason.
    ...(baseLineHeight === null
      ? null
      : {
          lineHeight: clampLineHeight({
            baseLineHeight,
            baseSize,
            scale,
            fontSize,
            family,
            source: lineHeightSource,
            spec,
          }),
        }),
    // No `fontWeight`, ever. On Android it is ignored or synthesised next to
    // an explicit family, and emitting one invites a caller to believe
    // `className="font-bold"` works here. Weight selects a *file*.
    fontFamily: resolveFamilyWeight(family, spec?.weight ?? role.weight),
  };
}

/**
 * Where a base line height came from. Decided in `resolve`, not re-derived.
 *
 * - `override` — the caller passed a number. Clampable, and warned about.
 * - `derived` — `size × DEFAULT_LINE_HEIGHT_RATIO`.
 * - `role` — `TYPE_SCALE`. Clamped like everything else; the exemption these
 *   used to have is what clipped the profile name. See below.
 */
type LineHeightSource = 'override' | 'derived' | 'role';

/**
 * The Thai line-box floor. A caller may ask for more leading than the family
 * needs; it may not ask for less.
 *
 * ## What actually clips, measured
 *
 * A TTF declares its line box in `hhea`, and Android lays text out to the
 * *declared* metrics rather than to where the ink is. A font may declare a
 * descent shallower than its own glyphs — and **Sarabun does**:
 * `hhea.descender` is 0.232 em while ◌ู reaches 0.353 em below the baseline.
 * A third of the vowel is outside the box the font asked for, and nothing
 * warns.
 *
 * An explicit `lineHeight` is what triggers it. RN's `CustomLineHeightSpan`
 * discards Android's `includeFontPadding` room (`top`/`bottom`, which *are*
 * deep enough) in favour of `ascent`/`descent`, then splits any slack evenly.
 * So the floor is per-family and measured, in
 * `FontFamilyDef.minLineHeightRatio` — regenerate with
 * `node scripts/font-metrics.mjs`.
 *
 * ## What this replaced, and why it was wrong
 *
 * A flat 1.45, guessed. It read as principled and it was not: Noto declares a
 * 0.450 em descent against a 0.265 em deepest mark, so Noto could never clip
 * at any plausible ratio, and a number validated against Noto tells you
 * nothing about the two families that were actually broken.
 *
 * The same guess also carried an exemption for `display`, `title`, and
 * `heading`, on the reasoning that the ratio is a proxy for *absolute* descent
 * room and large sizes have plenty. **That reasoning was wrong** — font
 * metrics are per-em, so the requirement is scale-invariant and a ratio is
 * exactly the right unit. The exemption is gone, and it was the direct cause
 * of the worst symptom the device pass found: the profile screen's name is
 * `type="heading"` at 20/28 = 1.40, exempt, and in Sarabun it lost most of
 * its below-baseline vowels.
 */
function clampLineHeight({
  baseLineHeight,
  baseSize,
  scale,
  fontSize,
  family,
  source,
  spec,
}: {
  baseLineHeight: number;
  baseSize: number;
  scale: number;
  fontSize: number;
  family: FontFamilyId;
  source: LineHeightSource;
  spec: TextSpec | undefined;
}): number {
  const ratio = FONT_FAMILIES[family].minLineHeightRatio ?? FALLBACK_MIN_LINE_HEIGHT_RATIO;
  const requested = Math.round(baseLineHeight * scale);
  // `ceil`, not `round`. Rounding a *minimum* down defeats it: at 18px a 1.45
  // floor is 26.1, and `Math.round` hands back 26 — a ratio of 1.444, still
  // under the bar the clamp exists to hold.
  const floor = Math.ceil(fontSize * ratio);

  if (requested >= floor) return requested;

  /*
   * Warn only when the caller asked for something genuinely tight, measured
   * against `DEFAULT_LINE_HEIGHT_RATIO` rather than against the family floor.
   *
   * Two things are not the author's mistake and must not be reported as one.
   * A role's line height being under a *family's* floor is routine — the type
   * scale is family-agnostic by design and adapting it is exactly this
   * function's job. And an override like the composer's 24-over-16 is a
   * perfectly ordinary 1.5 that happens to sit a hair under Noto's measured
   * 1.52; telling its author to "raise it" would be advice to chase a number
   * that is already fine. Both would fire on half the app the moment someone
   * picks a non-default face, and a warning that cries wolf gets muted.
   *
   * What is left is the real signal: a caller deliberately tightening a line
   * box, like the `lineHeight={16}` against a 12px `caption` (1.33) that
   * clipped on hardware.
   */
  if (__DEV__ && source === 'override' && baseLineHeight < baseSize * DEFAULT_LINE_HEIGHT_RATIO) {
    // `console.warn`, not a throw: the clamped value is correct and the screen
    // renders fine. A note to the author, not a broken app for the user.
    console.warn(
      `[typography] lineHeight ${requested} raised to ${floor} for fontSize ${fontSize} ` +
        `in "${family}" (minimum ratio ${ratio}). Thai below-baseline marks clip below it on ` +
        `Android. Spec: ${JSON.stringify(spec)}. Drop the lineHeight override, or raise it.`,
    );
  }

  return floor;
}

/**
 * The resolver, bound to the user's current preferences.
 *
 * Reads `useFontScale()` rather than recomputing the ratio: that hook divides
 * the OS accessibility scale back out, and `use-font-scale.ts` explains why
 * removing the division silently makes the setup screen's px preview wrong on
 * any device whose system font size is not the default. The multiplier stays
 * there; only the tables moved.
 */
export function useTypography(): (spec?: TextSpec) => TextStyle {
  // Already OS-compensated.
  const sizeScale = useFontScale();
  const fontFamily = usePreferencesStore((state) => state.fontFamily);
  const loaded = useLoadedFontFamilies();

  return useCallback(
    (spec?: TextSpec) => resolve(fontFamily, spec, loaded, sizeScale),
    [fontFamily, loaded, sizeScale],
  );
}

/**
 * The same numbers `useTypography()` emits, in the dp the text actually
 * **paints** at. For sizing a container, never for a `style` prop.
 *
 * ## Two unit spaces, and mixing them is silent
 *
 * `useTypography()` returns *style* units, with the OS accessibility scale
 * divided out — see `use-font-scale.ts` for why that division exists. RN
 * multiplies it back at paint time because `allowFontScaling` is on, so the
 * emitted number and the painted number are only equal on a device at the
 * default system font size. **A container dimension is dp and nothing scales
 * it**, so sizing one from an emitted value under-reserves by exactly the OS
 * scale factor:
 *
 * ```
 * osScale 1.0  →  emitted 16, paints 16.0   ✔ container fits
 * osScale 2.0  →  emitted  8, paints 16.0   ✘ container half the size needed
 * ```
 *
 * That is not hypothetical. It shipped twice on this branch — the bottom tab
 * bar's `labelHeadroom` and `tab-buttons`' `minHeight` — and in both cases it
 * disabled a Thai-clipping fix for precisely the users it was built for:
 * someone who raised their system font size for legibility is the same person
 * who picks the looped face for legibility.
 *
 * ## Why it reads as correct
 *
 * A dev device sits at OS scale 1, where the two spaces coincide. The bug is
 * invisible in every screenshot, every simulator run, and every test that does
 * not mock `fontScale`. Reach for this hook whenever a number leaves a `style`
 * prop and becomes a height, a width, or a padding.
 */
export function useLayoutTypography(): (spec?: TextSpec) => TextStyle {
  const fontSize = usePreferencesStore((state) => state.fontSize);
  const fontFamily = usePreferencesStore((state) => state.fontFamily);
  const loaded = useLoadedFontFamilies();

  return useCallback(
    // `typographyFor` is the pure form and carries no OS compensation, which
    // is exactly what dp space means. The two hooks differ only in that.
    (spec?: TextSpec) => typographyFor({ fontSize, fontFamily }, spec, loaded),
    [fontFamily, fontSize, loaded],
  );
}

/**
 * Which family a node will *actually* render in, after the load-state
 * fallback.
 *
 * Exported because a container sometimes has to size itself for the same
 * answer the text uses, and asking the store directly gets a different one:
 * `usePreferencesStore().fontFamily` is what the user picked, which during
 * the deferred-font window — and permanently if a deferred load fails, which
 * `app/_layout.tsx` swallows by design — is not what is on screen. The bottom
 * tab bar was reading the raw preference to compute its headroom while its
 * label read this, so the bar could be sized for a font the label was not
 * using.
 */
export function useResolvedFontFamily(override?: FontFamilyId): FontFamilyId {
  const preference = usePreferencesStore((state) => state.fontFamily);
  const loaded = useLoadedFontFamilies();

  return usableFamily(override ?? preference, loaded);
}

/**
 * Pure form, for previewing a preference the user has not selected yet.
 *
 * Carries **no** OS compensation — it cannot, having no access to the device —
 * exactly like `fontScaleFor`. Anything rendering text a user reads as content
 * should use the hook; this is for a control that has to show what a choice
 * *would* look like, which by definition is not the current one.
 *
 * `loaded` defaults to "every family is available", because a pure function
 * has no way to know otherwise. The two pickers pass the real set in from
 * `useLoadedFontFamilies()` — a preview rendering Noto under a label reading
 * สารบรรณ is the one thing that control must not do.
 */
export function typographyFor(
  prefs: TypographyPreferences,
  spec?: TextSpec,
  loaded: ReadonlySet<FontFamilyId> = ALL_FAMILIES,
): TextStyle {
  return resolve(
    prefs.fontFamily,
    spec,
    loaded,
    FONT_SIZE_STEPS[prefs.fontSize] / BASELINE_PX,
  );
}
