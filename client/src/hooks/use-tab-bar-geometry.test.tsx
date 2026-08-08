/**
 * The bottom tab bar's measurements, and the drift they exist to prevent.
 *
 * This hook has one job that a reader would not guess from its name: **the
 * bar's height depends on the typeface.** The label carries no `lineHeight`,
 * so it keeps the font's natural box, and looped and Sarabun are 15% and 23%
 * taller there than Noto. A bar sized when Noto was the only face clips the
 * bottom of every label under either — confirmed on hardware, and invisible to
 * every other test in this repo because nothing else renders a fixed-height
 * container around a `lineHeight`-less run.
 *
 * The second job is why it is a hook rather than two constants:
 * `app/(tabs)/camera.tsx` and `app/(tabs)/_layout.tsx` both need these numbers,
 * they used to each hold a copy, and the copies drifted — the bar grew
 * `labelHeadroom` and the camera's overlay clearance did not follow, so on
 * Sarabun 14px of clearance quietly became 10. The tests below assert the
 * numbers, not the sharing, because the numbers are what a caller consumes; a
 * second copy that computed something different would fail them.
 *
 * `Platform.OS` is `'ios'` under jest-expo's default preset, so the iOS
 * branches (base 60, margin 2) are the ones exercised. Both branches are plain
 * literals; what varies with input, and is therefore worth asserting, is the
 * headroom.
 *
 * **`renderHook` is async here**, like `render` — RNTL v14 returns a promise so
 * it can flush concurrent rendering, and an unawaited call hands back an object
 * with no `result` at all.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

/**
 * The OS accessibility font scale, which jest-expo otherwise reports as 2 —
 * a value that makes every number below unrecognisable against the device it
 * was measured on. Pinned to 1 by default and varied deliberately in the last
 * block, following `components/themed-text.test.tsx`.
 */
const mockOsFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({
    width: 390,
    height: 844,
    scale: 2,
    fontScale: mockOsFontScale.current,
  }),
}));

import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import { useTabBarGeometry, TAB_LABEL_SIZE } from './use-tab-bar-geometry';
import { resolveFamilyWeight, typographyFor } from './use-typography';
import { usePreferencesStore, type FontSizePreference, type PreferencesState } from '@/stores';
import { LoadedFontFamiliesProvider } from '@/theme/font-loading';
import { FONT_FAMILIES, type FontFamilyId } from '@/theme/typography';

/** A notched phone, matching `__test__/test-utils.tsx`. */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const IOS_BASE_HEIGHT = 60;
const IOS_MARGIN_BOTTOM = 2;
const INSET = METRICS.insets.bottom;

/**
 * `loaded` defaults to the blocking set (`noto`, `mono`), which is exactly the
 * state the app is in before a deferred family lands — so a test that wants
 * the chosen family to be *live* has to say so.
 */
function wrapperFor(loaded: readonly FontFamilyId[], insetBottom = INSET) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider
        initialMetrics={{
          ...METRICS,
          insets: { ...METRICS.insets, bottom: insetBottom },
        }}
      >
        <LoadedFontFamiliesProvider families={loaded}>{children}</LoadedFontFamiliesProvider>
      </SafeAreaProvider>
    );
  };
}

/**
 * `await act(async () => …)`, and it has to be that exact shape.
 *
 * A bare `setState` re-renders a hook mounted earlier in the same test outside
 * React's batch, which fills the run with act warnings. But RNTL v14's `act` is
 * async, so the tempting `act(() => setState(…))` opens a scope nobody closes —
 * the *next* `renderHook` then resolves with `result.current === null` and
 * every assertion fails on a property of null, nowhere near the mistake.
 */
async function setPreference(next: Partial<PreferencesState>) {
  await act(async () => {
    usePreferencesStore.setState(next);
  });
}

async function geometryFor(family: FontFamilyId, loaded: readonly FontFamilyId[] = [family]) {
  await setPreference({ fontFamily: family });
  const view = await renderHook(() => useTabBarGeometry(), {
    wrapper: wrapperFor(loaded),
  });
  return view.result.current;
}

/** Height above the fixed base and the inset — the only part that varies. */
const headroomOf = (height: number) => height - IOS_BASE_HEIGHT - INSET;

beforeEach(async () => {
  mockOsFontScale.current = 1;
  await setPreference({ fontSize: 'medium', fontFamily: 'noto' });
});

describe('useTabBarGeometry — the label', () => {
  it('carries no line height, so the label keeps the font’s natural box', async () => {
    // Not an oversight and not safe to "fix": an explicit line height here
    // fights react-navigation, which positions the label itself. The clipping
    // is fixed by the bar's height instead — that is what `labelHeadroom` is.
    expect((await geometryFor('noto')).labelStyle).not.toHaveProperty('lineHeight');
  });

  it('never emits a fontWeight, selecting the bold file instead', async () => {
    const { labelStyle } = await geometryFor('noto');

    expect(labelStyle).not.toHaveProperty('fontWeight');
    expect(labelStyle.fontFamily).toBe(resolveFamilyWeight('noto', 'bold'));
  });

  it('resolves the label through the same chain as every other text node', async () => {
    await setPreference({ fontSize: 'large' });

    expect((await geometryFor('sarabun')).labelStyle).toEqual(
      typographyFor(
        { fontSize: 'large', fontFamily: 'sarabun' },
        { size: TAB_LABEL_SIZE, weight: 'bold', lineHeight: null },
      ),
    );
  });
});

describe('useTabBarGeometry — the height', () => {
  /*
   * The acceptance criterion for the whole headroom mechanism, the same one
   * the line-height floor has: **a Noto user's bar is exactly what it was.**
   * If this fails, the headroom has stopped being a fix for the two families
   * that overflow and started being a layout change for everyone.
   */
  it('adds nothing for the default family', async () => {
    expect((await geometryFor('noto')).height).toBe(IOS_BASE_HEIGHT + INSET);
  });

  it.each<[FontFamilyId, number]>([
    ['noto', 0],
    // 11px label × (1.74 − 1.52) = 2.42 → 3.
    ['looped', 3],
    // 11px label × (1.86 − 1.52) = 3.74 → 4.
    ['sarabun', 4],
  ])('buys back %s’s extra natural box as headroom', async (family, headroom) => {
    expect(headroomOf((await geometryFor(family)).height)).toBe(headroom);
  });

  /*
   * The headroom is a *ratio* difference applied to the rendered px, so it has
   * to grow with the size preference — a bar that bought back 4px for an 11px
   * label still clips a 15px one. This is the assertion that fails if someone
   * "simplifies" the headroom into a per-family constant.
   */
  it.each<[FontSizePreference, number]>([
    ['small', 4],
    ['medium', 4],
    ['large', 5],
    ['xlarge', 6],
  ])('tracks the size preference on the %s rung', async (fontSize, headroom) => {
    await setPreference({ fontSize });

    expect(headroomOf((await geometryFor('sarabun')).height)).toBe(headroom);
  });

  it('derives the headroom from the emitted px, not from the base size', async () => {
    // Restated as the formula rather than as literals, over every combination:
    // the tables above pin the numbers, this pins the rule that produced them.
    for (const fontSize of ['small', 'medium', 'large', 'xlarge'] as const) {
      for (const family of ['noto', 'looped', 'sarabun'] as const) {
        await setPreference({ fontSize });
        const { height, labelStyle } = await geometryFor(family);

        expect({ fontSize, family, headroom: headroomOf(height) }).toEqual({
          fontSize,
          family,
          headroom: Math.ceil(
            (labelStyle.fontSize ?? 0) *
              (FONT_FAMILIES[family].naturalLineHeightRatio -
                FONT_FAMILIES.noto.naturalLineHeightRatio),
          ),
        });
      }
    }
  });

  it('never shrinks the bar for a family with a tighter box than Noto', async () => {
    // `Math.max(0, …)` in the hook. `mono`'s natural box is 1.3 against Noto's
    // 1.52, so without the clamp a bar resolving to it would lose 3px.
    expect(headroomOf((await geometryFor('mono', ['mono'])).height)).toBe(0);
  });
});

/**
 * The bug the hook was extracted to make impossible: two files holding the
 * same arithmetic, one of them stale.
 *
 * `totalHeight` is what `camera.tsx` clears its overlay past, and it has to be
 * the *whole* footprint — the bar is `position: 'absolute'`, so nothing
 * reserves this space and a `totalHeight` that forgot the margin puts the
 * overlay under the bar's bottom edge.
 */
describe('useTabBarGeometry — what a screen has to clear', () => {
  it('includes the margin below the bar, not just its height', async () => {
    const { height, marginBottom, totalHeight } = await geometryFor('noto');

    expect(totalHeight).toBe(height + marginBottom);
    expect(marginBottom).toBe(IOS_MARGIN_BOTTOM);
  });

  it('grows the clearance by the same headroom the bar grew by', async () => {
    // The exact drift: `_layout.tsx` gained `labelHeadroom` and camera.tsx's
    // copy did not, so on Sarabun the intended 14px of clearance became 10.
    const sarabun = await geometryFor('sarabun');
    const noto = await geometryFor('noto');

    expect(sarabun.totalHeight - noto.totalHeight).toBe(4);
  });

  it('honours the safe-area inset it was given', async () => {
    const view = await renderHook(() => useTabBarGeometry(), {
      wrapper: wrapperFor(['noto'], 0),
    });

    expect(view.result.current.height).toBe(IOS_BASE_HEIGHT);
    // The padding does not collapse with the inset — a bar with no inset still
    // needs room under its labels.
    expect(view.result.current.paddingBottom).toBe(12);
  });

  it('takes the deeper of the inset and the platform minimum for padding', async () => {
    expect((await geometryFor('noto')).paddingBottom).toBe(INSET);
  });
});

/**
 * The OS accessibility font scale, which the headroom has to account for and
 * for a while did not.
 *
 * The mechanism: `useFontScale` divides the OS scale out of the emitted
 * `fontSize` (see its own doc comment — that division is what stops the app
 * preference and the OS setting from compounding), and RN multiplies it back
 * in at paint time because `allowFontScaling` is on. So the label *paints* at
 * `labelStyle.fontSize × osScale`, while the bar's `height` is dp and nothing
 * scales it.
 *
 * Sizing the bar from the emitted number therefore under-reserved by exactly
 * the OS scale factor, and the shortfall was largest for the users most likely
 * to have raised that setting — which, for an elderly-first product, is the
 * population the whole mechanism was built for. Measured at Sarabun/`xlarge`
 * before the fix:
 *
 *     osScale 1.0  → emitted 16, painted 16.0, headroom 6, needed 6  ✔
 *     osScale 1.3  → emitted 12, painted 15.6, headroom 5, needed 6  ✘
 *     osScale 2.0  → emitted  8, painted 16.0, headroom 3, needed 6  ✘
 *
 * `useTabBarGeometry` reads `useLayoutTypography()` for the headroom now — dp
 * units, for a dp dimension. The first three tests pin the default-device
 * numbers, which a fix must not move, and the last pins the invariant itself.
 */
describe('useTabBarGeometry — under an OS accessibility font scale', () => {
  it('still emits the size the preference promises, once RN scales it back', async () => {
    mockOsFontScale.current = 1.3;
    await setPreference({ fontSize: 'xlarge' });

    const { labelStyle } = await geometryFor('sarabun');

    // The division `useFontScale` performs: 11 × 1.375 × 1.04 / 1.3, which RN
    // multiplies by 1.3 again at paint time.
    expect(labelStyle.fontSize).toBe(Math.round((11 * (22 / 16) * 1.04) / 1.3));
  });

  it('leaves the default family alone whatever the OS setting is', async () => {
    // Noto needs no headroom at any scale, so this one cannot regress.
    for (const osScale of [1, 1.3, 2]) {
      mockOsFontScale.current = osScale;
      const { height } = await geometryFor('noto');

      expect({ osScale, headroom: headroomOf(height) }).toEqual({
        osScale,
        headroom: 0,
      });
    }
  });

  it('buys back the right headroom when the OS setting is the default', async () => {
    mockOsFontScale.current = 1;
    await setPreference({ fontSize: 'xlarge' });

    expect(headroomOf((await geometryFor('sarabun')).height)).toBe(6);
  });

  /**
   * The invariant the whole headroom mechanism claims: the bar reserves enough
   * room for the box the label **actually paints**.
   *
   * This was an `it.failing` when the headroom was computed from
   * `labelStyle.fontSize` — style units, with the OS accessibility scale
   * divided out — while `height` is dp and nothing scales it. It held at OS
   * scale 1, where the two spaces coincide, and broke by 3px at OS scale 2:
   * a clipped Thai vowel in the tab labels for a user who raised their system
   * font size, which is the exact symptom `labelHeadroom` exists to remove,
   * for the exact population it was built for. The hook reads
   * `useLayoutTypography()` now.
   */
  it('reserves room for the box the label actually paints', async () => {
    mockOsFontScale.current = 2;
    await setPreference({ fontSize: 'xlarge' });

    const { height, labelStyle } = await geometryFor('sarabun');
    const painted = (labelStyle.fontSize ?? 0) * mockOsFontScale.current;

    expect(headroomOf(height)).toBe(
      Math.ceil(
        painted *
          (FONT_FAMILIES.sarabun.naturalLineHeightRatio -
            FONT_FAMILIES.noto.naturalLineHeightRatio),
      ),
    );
  });
});

/**
 * **The reason `useResolvedFontFamily` exists**, asserted at the place that
 * needed it.
 *
 * The bar used to size itself from `usePreferencesStore().fontFamily` — what
 * the user picked — while its label rendered through the resolver, which falls
 * back to Noto until the family has actually landed. So during the deferred
 * window (and permanently if a deferred load failed, which `app/_layout.tsx`
 * swallows by design) the bar was sized for a font the label was not using:
 * 4px of headroom around Noto labels that did not need it.
 */
describe('useTabBarGeometry — while a deferred family has not landed', () => {
  it('sizes the bar for Noto, which is what the label is actually rendering', async () => {
    // Only the blocking families are loaded — the state every cold start
    // passes through, and the terminal state if the deferred load rejected.
    const { height, labelStyle } = await geometryFor('sarabun', []);

    expect(labelStyle.fontFamily).toBe(resolveFamilyWeight('noto', 'bold'));
    expect(headroomOf(height)).toBe(0);
  });

  it('grows the bar the moment the family lands', async () => {
    const pending = await geometryFor('sarabun', []);
    const landed = await geometryFor('sarabun', ['sarabun']);

    expect(landed.height - pending.height).toBe(4);
  });

  it('keeps the bar and the label on one answer for every family and load state', async () => {
    // The invariant, not the instance: whatever face the label ends up in, the
    // headroom must have been computed for that same face.
    for (const preference of ['noto', 'looped', 'sarabun'] as const) {
      for (const loaded of [[], [preference]] as const) {
        const { height, labelStyle } = await geometryFor(preference, loaded);
        const rendered = loaded.length ? preference : 'noto';
        const context = { preference, loaded: [...loaded] };

        expect({ ...context, face: labelStyle.fontFamily }).toEqual({
          ...context,
          face: resolveFamilyWeight(rendered, 'bold'),
        });
        expect({ ...context, headroom: headroomOf(height) }).toEqual({
          ...context,
          headroom: Math.ceil(
            (labelStyle.fontSize ?? 0) *
              Math.max(
                0,
                FONT_FAMILIES[rendered].naturalLineHeightRatio -
                  FONT_FAMILIES.noto.naturalLineHeightRatio,
              ),
          ),
        });
      }
    }
  });
});
