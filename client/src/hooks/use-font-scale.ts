/**
 * Turns `usePreferencesStore().fontSize` into a multiplier.
 *
 * **This hook is now an input to `hooks/use-typography.ts`, not a thing to
 * call directly.** It survives the move of the tables into
 * `theme/typography.ts` for one reason, and it is the reason written out at
 * length below: it divides the OS accessibility scale back out. That
 * compensation cannot move into the pure resolver, because a pure function has
 * no device to ask — so the multiplier stays a hook, the tables became data,
 * and `useTypography()` is what combines them.
 *
 * A component reaching for this directly and writing
 * `Math.round(15 * fontScale)` is how the app ended up with fourteen
 * hand-rolled copies of the same arithmetic, none of which knew about the
 * font-family preference when it arrived. Use `useTypography()`.
 *
 * `FONT_SIZE_STEPS` moved to `theme/typography.ts` — it is data the resolver,
 * the pickers, and the setup preview all read, and it stopped being this
 * file's to own the moment more than one of them needed it.
 */
import { useWindowDimensions } from 'react-native';

import { usePreferencesStore, type FontSizePreference } from '@/stores';
import { BASELINE_PX, FONT_SIZE_STEPS } from '@/theme/typography';

/**
 * The multiplier to apply to a literal px size.
 *
 * **The OS accessibility font size is divided out of it, deliberately.**
 * `<Text>` has `allowFontScaling` defaulting to true, so React Native
 * multiplies the system setting on top of whatever we compute. Left alone the
 * two compound — OS at 130% with the app at `xlarge` was ~1.79× — and
 * `app/onboarding/setup.tsx`, which previews the choice as a px number, was
 * telling the user something untrue on any device whose system font size was
 * not the default. Dividing here and letting RN multiply back means the net
 * size is exactly `base × preference` everywhere, which is what the preview
 * promises.
 *
 * The system setting is not ignored: it is expressed through the app's own
 * four steps, which is the control this app chose to put in front of the
 * user. A component that genuinely wants to stack both would opt out with
 * `allowFontScaling={false}` and multiply the OS scale itself — nothing does.
 *
 * `useWindowDimensions()` rather than `PixelRatio.getFontScale()` because the
 * hook re-renders when the setting changes, and on Android it can change
 * while the app is backgrounded.
 */
export function useFontScale(): number {
  const fontSize = usePreferencesStore((state) => state.fontSize);
  // `|| 1` guards a platform reporting 0 — dividing by it renders `Infinity`
  // px, which blanks the text rather than failing loudly.
  const { fontScale: osScale } = useWindowDimensions();

  return FONT_SIZE_STEPS[fontSize] / BASELINE_PX / (osScale || 1);
}

/**
 * Non-hook form, for pure helpers that already have `fontSize` in hand.
 *
 * Carries **no** OS compensation — it cannot, having no access to the device.
 * Anything rendering text should use the hook; this exists for pure functions
 * that reason about the preference itself.
 */
export function fontScaleFor(fontSize: FontSizePreference): number {
  return FONT_SIZE_STEPS[fontSize] / BASELINE_PX;
}
