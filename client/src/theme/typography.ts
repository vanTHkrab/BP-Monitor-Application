/**
 * The app's type system: the size ladder, the role scale, and the family
 * registry.
 *
 * These three tables used to live in three files — `FONT_SIZE_STEPS` in
 * `hooks/use-font-scale.ts`, the role sizes inside `components/themed-text.tsx`,
 * and the family names in `constants/theme.ts`. Splitting them meant the only
 * thing that could combine them was a component, so every non-`ThemedText`
 * caller re-derived the arithmetic by hand and each copy was free to drift.
 * They are data, they are read together, and they now sit together.
 *
 * **Nothing here multiplies.** The single chain
 * `Math.round(base × sizeScale × opticalScale)` lives in
 * `hooks/use-typography.ts` and nowhere else. This file only states the
 * numbers that go into it.
 *
 * Colours are deliberately absent for the same reason they are absent from
 * `constants/theme.ts`: they belong to `theme/tokens.js`, the single source
 * NativeWind, Tamagui, and React Navigation all read.
 */
import type { ThaiFontWeight } from '@/constants/theme';
// Type-only, and it has to stay that way: `stores/preferences.store.ts`
// imports `FONT_FAMILIES` from here at runtime to validate what it read back
// out of AsyncStorage. A value import in this direction would close that
// loop.
import type { FontSizePreference } from '@/stores/preferences.store';

/**
 * The four rungs of the font-size preference, in body-text px.
 *
 * Moved here from `use-font-scale.ts` unchanged. `medium` (16) is the 1.0
 * baseline every other number in the app is defined against, and it is the
 * number `app/onboarding/setup.tsx` previews — a mismatch between the two
 * makes the preview a lie.
 *
 * The elderly-first floor the old client documented is ~11px of rendered body
 * text; `small` stays above it once a component's own base is applied.
 */
export const FONT_SIZE_STEPS: Record<FontSizePreference, number> = {
  small: 14,
  medium: 16,
  large: 19,
  xlarge: 22,
};

export const BASELINE_PX = FONT_SIZE_STEPS.medium;

/** The twelve named roles. Was `ThemedTextType`. */
export type TypeRole =
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

export type TypeRoleSpec = {
  fontSize: number;
  lineHeight: number;
  weight: ThaiFontWeight;
};

/**
 * Base sizes in px, before the preference, before the optical correction, and
 * before the OS scale.
 *
 * Moved **verbatim** from `themed-text.tsx`'s `VARIANTS`. Not one px changed,
 * and that is a constraint rather than an accident: whether this set is a
 * typography scale at all is an open design decision recorded in
 * `docs/project/CLIENT-typography.md` §3, and it needs a physical-device pass
 * before anyone touches a number. Folding `heading` at 18-and-20 together, or
 * deciding whether 15/14/13 are three steps or one, is that change — not this
 * one.
 *
 * Line heights sit at roughly 1.45–1.5× on purpose. Thai stacks diacritics two
 * levels (สระบน plus วรรณยุกต์), so the ratio that reads as generous in Latin
 * is merely adequate here. **That ratio was tuned against Noto Sans Thai
 * alone** — the looped and Sarabun faces have not been checked against it on a
 * device, which is the first thing §5's device pass has to look at now that a
 * user can pick them.
 *
 * `default` is 16 because that is the baseline the size scale is defined
 * against, so it renders at exactly the px the setup screen previews.
 */
export const TYPE_SCALE: Record<TypeRole, TypeRoleSpec> = {
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

/** The ratio applied to a bare `size` prop that carries no explicit line height. */
export const DEFAULT_LINE_HEIGHT_RATIO = 1.45;

/**
 * Last-resort line-height floor, used only if a family somehow has no
 * `minLineHeightRatio`. **The real floor is per-family — see
 * `FontFamilyDef.minLineHeightRatio`.**
 *
 * 1.55 because it is the largest value the four shipped families measured, so
 * a family that arrives without a measurement is over-led rather than clipped.
 * Reaching this constant at all means someone added a family and skipped
 * `scripts/font-metrics.mjs`.
 *
 * A flat 1.45 was the first attempt and it was wrong in the way a guess is
 * wrong: it fixed Noto (which never had the problem) and left Sarabun and
 * looped clipping on a device.
 */
export const FALLBACK_MIN_LINE_HEIGHT_RATIO = 1.55;

export type FontFamilyId = 'noto' | 'looped' | 'sarabun' | 'mono';

export type FontFamilyDef = {
  /** Thai, user-facing. */
  label: string;
  /** Thai, one line for the picker card. */
  description: string;
  weights: Partial<Record<ThaiFontWeight, string>>;
  /** x-height compensation, 1 for `noto`. */
  opticalScale: number;
  /**
   * The smallest `lineHeight / fontSize` at which this face renders the glyphs
   * **this app asks it for** without clipping. Regenerate with
   * `node scripts/font-metrics.mjs` when a family is added or upgraded.
   *
   * Why it is per-family: a TTF declares its line box in `hhea`, and Android
   * lays text out to the *declared* metrics rather than to where the ink
   * actually is. A font may declare a descent shallower than its own glyphs,
   * and **Sarabun does** — `hhea.descender` is 0.232 em while ◌ู reaches
   * 0.353 em below the baseline. Everything past the declared line falls
   * outside the line box and is clipped, silently.
   *
   * React Native's `CustomLineHeightSpan` is what makes an explicit
   * `lineHeight` trigger that: it discards Android's `includeFontPadding`
   * room (`top`/`bottom`, which *are* deep enough) in favour of
   * `ascent`/`descent`, then splits the leading evenly between them. So
   * covering a shortfall on one side costs twice as much line height, which
   * is where the `2 ×` in the script's formula comes from.
   *
   * **This is the clipping minimum and nothing else.** It is deliberately not
   * raised to the font's own declared box, even though three of the four
   * families declare a larger one. Honouring the declared box is a defensible
   * typographic position, but it is a leading redesign: it would have lifted
   * `noto`'s floor from 1.141 to 1.511 and loosened every heading in the app
   * for the default family, as a side effect of a clipping fix. Where a role
   * already clears the floor — and every `noto` role does — the number in
   * `TYPE_SCALE` is what renders, untouched.
   */
  minLineHeightRatio: number;
  /**
   * The box a run of this face takes with **no** `lineHeight` at all — the
   * OS/2 win metrics, which is what `includeFontPadding` reserves.
   *
   * Only a fixed-height container needs this. `lineHeight: null` sites keep
   * the natural box, and looped and Sarabun are 15 % and 23 % taller than Noto
   * here, so anything whose height was fixed against Noto overflows and clips
   * the bottom. That is the bottom tab bar, and it is a *different* bug from
   * the one `minLineHeightRatio` fixes — see `app/(tabs)/_layout.tsx`.
   */
  naturalLineHeightRatio: number;
  /** 'full' = covers Thai. 'latin-only' families must never appear in the picker. */
  thai: 'full' | 'latin-only';
};

/**
 * Every family the app can name, and every file name it can emit.
 *
 * **A name here that `app/_layout.tsx` does not load is a silent bug**, not a
 * crash. React Native falls back to the OEM's own Thai face, which is a
 * different typeface on every Android manufacturer and the entire reason this
 * app bundles one. `theme/typography.test.ts` pins the two lists together, and
 * `hooks/use-typography.ts` additionally refuses to emit a name the device has
 * not confirmed it loaded yet.
 *
 * ## Why only two weights outside `noto`
 *
 * `noto` carries four because the app genuinely uses four — see the comment on
 * `useFonts` in `app/_layout.tsx`. The other three carry regular + bold only,
 * and `weights` is `Partial` precisely so that is expressible. Four weights ×
 * three extra families is ~4 MB of font binary for a minority preference, paid
 * by everyone at install time; `resolveFamilyWeight` in `use-typography.ts`
 * maps the two missing rungs onto their neighbours instead.
 *
 * ## `opticalScale`
 *
 * Two faces at the same nominal px do not read as the same size — what the eye
 * measures is the x-height (and in Thai, the body height of the base glyph).
 * This multiplier corrects for that so switching family changes the *shape* of
 * the text and not its apparent size.
 *
 * ⚠️ **The three non-`noto` values below are starting estimates and have NOT
 * been verified on a device.** They were chosen by reading the fonts' metrics,
 * not by looking at a phone. A device pass has to set each one by putting the
 * same paragraph in each family side by side at `body` and at `heading` and
 * adjusting until they read as equal weight on the page. Do not treat these as
 * measured.
 */
export const FONT_FAMILIES: Record<FontFamilyId, FontFamilyDef> = {
  noto: {
    label: 'โนโตซานส์ไทย',
    description: 'แบบมาตรฐานของแอป อ่านง่าย เส้นคมชัด',
    weights: {
      regular: 'NotoSansThai_400Regular',
      medium: 'NotoSansThai_500Medium',
      semibold: 'NotoSansThai_600SemiBold',
      bold: 'NotoSansThai_700Bold',
    },
    // The reference face. Every other number here is relative to this one.
    opticalScale: 1,
    /*
     * 1.15, and the number is low because Noto's metrics are honest: it
     * declares a 0.450 em descent against a 0.265 em deepest mark, so it has
     * never clipped at any ratio this app uses. Which is exactly why a flat
     * floor validated on Noto could not catch the other two.
     *
     * **Every role in `TYPE_SCALE` clears this**, including `display` at
     * 1.18 — the lowest in the table. A Noto user therefore sees no pixel
     * change from the whole line-height mechanism, which is the point: the
     * clamp exists to rescue faces that clip, not to restyle the default.
     */
    minLineHeightRatio: 1.15,
    naturalLineHeightRatio: 1.52,
    thai: 'full',
  },
  looped: {
    label: 'ไทยมีหัว',
    description: 'ตัวอักษรมีหัวกลม คุ้นตาแบบหนังสือเรียน',
    weights: {
      regular: 'NotoSansThaiLooped_400Regular',
      bold: 'NotoSansThaiLooped_700Bold',
    },
    // ⚠️ Estimate — needs a device pass. The loops sit inside the same body
    // height as Noto's terminals, so the glyph reads marginally busier and
    // marginally smaller at the same px.
    opticalScale: 1.02,
    /*
     * 1.55, driven by the descent: 0.324 em of ink under a 0.350 em declared
     * descent looks safe, but the span shrinks *both* sides when the leading
     * is negative, so a tight `lineHeight` still eats into it. Its natural
     * box is 1.74 — the widest gap to Noto of any family, and what overflowed
     * the tab bar.
     */
    minLineHeightRatio: 1.55,
    naturalLineHeightRatio: 1.74,
    thai: 'full',
  },
  sarabun: {
    label: 'สารบรรณ',
    description: 'ทางการ ใกล้เคียงเอกสารราชการไทย',
    weights: {
      regular: 'Sarabun_400Regular',
      bold: 'Sarabun_700Bold',
    },
    // ⚠️ Estimate — needs a device pass. Sarabun's Latin x-height is
    // noticeably shorter than Noto's, and Thai numerals ride lower.
    opticalScale: 1.04,
    /*
     * 1.55, and this is the family the device pass caught. Sarabun declares a
     * 0.232 em descent while ◌ู reaches 0.353 em — a third of the vowel sits
     * outside the box the font asks for. The floor buys the 0.121 em
     * shortfall back at 2×, because the span splits the leading evenly.
     */
    minLineHeightRatio: 1.55,
    naturalLineHeightRatio: 1.86,
    thai: 'full',
  },
  mono: {
    label: 'ตัวเลขความกว้างคงที่',
    description: 'ใช้ภายในกับตัวเลขความดันเท่านั้น',
    weights: {
      regular: 'IBMPlexMono_400Regular',
      bold: 'IBMPlexMono_700Bold',
    },
    // ⚠️ Estimate — needs a device pass. Plex Mono has a tall x-height, so it
    // reads larger than Noto at the same px and is pulled back.
    opticalScale: 0.96,
    /*
     * 1.03, measured over **digits and `/` only** — the entire vocabulary this
     * face is ever handed. An earlier pass scanned Latin Extended-A for every
     * family and got 1.55 here, set by `Ů`: a glyph `mono` cannot be asked to
     * draw, which inflated the blood-pressure figure's line box by 32% and
     * broke the `flex-row items-end` alignment between the `display` digits
     * and the `size={36}` slash beside them on the detail screen.
     *
     * A floor derived from glyphs a face cannot render is not a measurement.
     * The scanned range is a property of the family in
     * `scripts/font-metrics.mjs`.
     */
    minLineHeightRatio: 1.03,
    naturalLineHeightRatio: 1.3,
    /**
     * **Latin-only, and therefore internal.** It must never reach the family
     * picker: selecting it app-wide would drop every Thai string back to the
     * OEM system face. `FontFamilyPicker` filters on this field rather than
     * on a hand-maintained list so a future Latin-only family cannot leak in
     * by omission.
     *
     * What it is for: locking the blood-pressure digits to a tabular face so
     * `120/80` occupies the same width in the home hero card, the history
     * row, and the detail screen. Proportional digits make a column of
     * readings jitter, which is exactly the comparison those screens exist to
     * support — and it means the figure stops following a family preference
     * that was never about numerals.
     */
    thai: 'latin-only',
  },
};

/** The families offered to the user. `mono` is excluded by construction. */
export const SELECTABLE_FONT_FAMILIES = (
  Object.keys(FONT_FAMILIES) as FontFamilyId[]
).filter((id) => FONT_FAMILIES[id].thai === 'full');

/**
 * Is this any family the registry knows, including the internal ones?
 *
 * `Object.hasOwn`, not `in`. `'toString' in FONT_FAMILIES` is true — the
 * prototype chain is part of `in` — so the naive form would accept
 * `'constructor'` out of AsyncStorage as a font family and then name
 * `undefined` as a `fontFamily`.
 */
export const isFontFamily = (value: unknown): value is FontFamilyId =>
  typeof value === 'string' && Object.hasOwn(FONT_FAMILIES, value);

/**
 * Is this a family a **user** may hold as their app-wide preference?
 *
 * This is the one the store hydrates against, and it is deliberately stricter
 * than `isFontFamily`. `mono` is a real family — `isFontFamily('mono')` is
 * correctly true, because `family="mono"` is a legitimate per-node override —
 * but it is Latin-only, so as an *app-wide* preference it drops every Thai
 * string in the product to the OEM face.
 *
 * `FontFamilyPicker` already cannot offer it, and that filter is a real
 * structural guard for the UI. This is the second lock on the second door: a
 * `'mono'` reaching AsyncStorage by any other route — a dev tool, a bad
 * migration, a future code path — must not hydrate into `state.fontFamily`.
 * A guard that only exists on the path you thought of is not a guard.
 */
export const isSelectableFontFamily = (value: unknown): value is FontFamilyId =>
  isFontFamily(value) && FONT_FAMILIES[value].thai === 'full';
