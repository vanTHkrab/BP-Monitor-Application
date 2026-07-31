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
import { usePreferencesStore, type FontSizePreference } from '@/stores';

export const FONT_SIZE_STEPS: Record<FontSizePreference, number> = {
  small: 14,
  medium: 16,
  large: 19,
  xlarge: 22,
};

const BASELINE_PX = FONT_SIZE_STEPS.medium;

export function useFontScale(): number {
  const fontSize = usePreferencesStore((state) => state.fontSize);
  return FONT_SIZE_STEPS[fontSize] / BASELINE_PX;
}

/** Non-hook form, for pure helpers that already have `fontSize` in hand. */
export function fontScaleFor(fontSize: FontSizePreference): number {
  return FONT_SIZE_STEPS[fontSize] / BASELINE_PX;
}
