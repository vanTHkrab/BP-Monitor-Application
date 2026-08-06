/**
 * Turns `usePreferencesStore().fontSize` into a multiplier a component can
 * apply to its own literal sizes: `Math.round(BASE_PX * scale)`.
 *
 * A multiplier rather than a per-role lookup table, because the app has no
 * shared typography scale — every component still hardcodes its own body /
 * label / heading sizes (see `docs/todo/CLIENT-onboarding.md`, "Font size is
 * persisted but not yet consumed app-wide"). A multiplier preserves each
 * component's existing proportions without requiring that redesign, and is
 * the smallest change that makes the preference actually do something.
 *
 * The four steps are body-text px, matching the setup screen's own preview
 * (`app/onboarding/setup.tsx`) so the number the user saw while choosing is
 * exactly the baseline this hook scales from — a mismatch there would make
 * the preview a lie. `medium` (16px) is the 1.0 baseline. The elderly-first
 * floor the old client documented is ~11px body text; `small` stays above it
 * once a component's own base is applied.
 */
import { useWindowDimensions } from 'react-native';

import { usePreferencesStore, type FontSizePreference } from '@/stores';

export const FONT_SIZE_STEPS: Record<FontSizePreference, number> = {
  small: 14,
  medium: 16,
  large: 19,
  xlarge: 22,
};

const BASELINE_PX = FONT_SIZE_STEPS.medium;

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
