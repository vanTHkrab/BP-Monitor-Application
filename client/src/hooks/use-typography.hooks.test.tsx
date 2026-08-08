/**
 * The React-bound exports of `use-typography.ts`.
 *
 * A second file beside `use-typography.test.ts` rather than more cases in it,
 * and the split is the one that file's own header draws: everything there goes
 * through `typographyFor`, the pure form, because every rule it asserts is
 * arithmetic. These two cannot — one reads a context and one reads the device —
 * so they need a render, and mixing rendered cases into a file that deliberately
 * has none would blur why any given test is shaped the way it is.
 *
 * What is actually at stake here is the gap between "what the user picked" and
 * "what is on the screen". `usePreferencesStore().fontFamily` answers the first.
 * During the deferred-font window — and permanently if a deferred load failed,
 * which `app/_layout.tsx` swallows by design — it is not the second, and a
 * caller that sizes a container from it disagrees with the text inside it.
 * `useResolvedFontFamily` exists to make one answer available to both.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

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

import {
  useResolvedFontFamily,
  useTypography,
  usePreviewTypography,
  typographyFor,
} from './use-typography';
import { usePreferencesStore, type PreferencesState } from '@/stores';
import { LoadedFontFamiliesProvider } from '@/theme/font-loading';
import { FONT_FAMILIES, type FontFamilyId } from '@/theme/typography';

function wrapperFor(loaded: readonly FontFamilyId[]) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <LoadedFontFamiliesProvider families={loaded}>{children}</LoadedFontFamiliesProvider>;
  };
}

async function setPreference(next: Partial<PreferencesState>) {
  // See `use-tab-bar-geometry.test.tsx` — RNTL v14's `act` is async, and the
  // sync-callback form leaves a scope open that nulls the next render's result.
  await act(async () => {
    usePreferencesStore.setState(next);
  });
}

async function resolvedFamily(override?: FontFamilyId, loaded: readonly FontFamilyId[] = []) {
  const view = await renderHook(() => useResolvedFontFamily(override), {
    wrapper: wrapperFor(loaded),
  });
  return view.result.current;
}

beforeEach(async () => {
  mockOsFontScale.current = 1;
  await setPreference({ fontSize: 'medium', fontFamily: 'noto' });
});

describe('useResolvedFontFamily', () => {
  it('answers with the preference once that family has landed', async () => {
    await setPreference({ fontFamily: 'looped' });

    expect(await resolvedFamily(undefined, ['looped'])).toBe('looped');
  });

  /*
   * The deferred-font window, which is a normal state rather than an error:
   * `looped` and `sarabun` load after first paint. Naming an unregistered
   * family does not throw — RN substitutes the OEM's own Thai face, which is a
   * different typeface per Android manufacturer and the entire reason this app
   * bundles one. Noto blocked the splash, so it is always safe to name.
   */
  it('falls back to noto while the chosen family is still loading', async () => {
    await setPreference({ fontFamily: 'sarabun' });

    expect(await resolvedFamily(undefined, [])).toBe('noto');
  });

  /*
   * The same answer for the permanent case, which is the one nothing else
   * covers: `app/_layout.tsx` swallows a rejected deferred load by design, so
   * "not loaded" can be the terminal state for the whole session rather than a
   * few hundred milliseconds. There is no separate branch for it — that is the
   * point of asserting it.
   */
  it('keeps falling back for a family whose load never lands', async () => {
    await setPreference({ fontFamily: 'looped' });
    const first = await resolvedFamily(undefined, []);
    const later = await resolvedFamily(undefined, []);

    expect([first, later]).toEqual(['noto', 'noto']);
  });

  it('resolves an explicit override rather than the preference', async () => {
    await setPreference({ fontFamily: 'sarabun' });

    // `mono` blocks the splash with noto, so a `family="mono"` node is usable
    // from first paint — which is why the blood-pressure figure does not swap
    // typeface mid-launch.
    expect(await resolvedFamily('mono', [])).toBe('mono');
  });

  it('falls back for an override the device has not loaded either', async () => {
    expect(await resolvedFamily('sarabun', [])).toBe('noto');
  });

  it('never returns a family the caller cannot safely name', async () => {
    // The invariant behind all of the above: whatever comes out, the device has
    // it. A caller may name the result without checking anything.
    for (const preference of ['noto', 'looped', 'sarabun'] as const) {
      for (const loaded of [[], ['looped'], ['sarabun'], ['looped', 'sarabun']] as const) {
        await setPreference({ fontFamily: preference });
        const resolved = await resolvedFamily(undefined, loaded);
        const available = new Set<FontFamilyId>(['noto', 'mono', ...loaded]);

        expect({
          preference,
          loaded: [...loaded],
          safe: available.has(resolved),
        }).toEqual({
          preference,
          loaded: [...loaded],
          safe: true,
        });
      }
    }
  });
});

describe('useTypography', () => {
  /*
   * The half `typographyFor` cannot carry: `useFontScale` divides the OS
   * accessibility scale out so RN's `allowFontScaling` multiplication does not
   * compound with the app's own preference. `themed-text.test.tsx` pins it
   * through a component; this pins it at the resolver, which is what the four
   * `<TextInput>` fields and the chart's style props actually call.
   */
  it('divides the OS accessibility scale back out', async () => {
    mockOsFontScale.current = 1.3;
    await setPreference({ fontSize: 'xlarge' });

    const view = await renderHook(() => useTypography(), {
      wrapper: wrapperFor([]),
    });

    // 16 × (22/16) / 1.3; RN multiplies by 1.3 at paint and lands on 22.
    expect(view.result.current({ type: 'default' }).fontSize).toBe(Math.round(22 / 1.3));
  });

  it('agrees with the pure form when the OS scale is the default', async () => {
    await setPreference({ fontSize: 'large', fontFamily: 'looped' });
    const view = await renderHook(() => useTypography(), {
      wrapper: wrapperFor(['looped']),
    });

    expect(view.result.current({ type: 'heading' })).toEqual(
      typographyFor({ fontSize: 'large', fontFamily: 'looped' }, { type: 'heading' }),
    );
  });

  /*
   * The consequence of the fallback that is easy to forget: the *optical scale*
   * follows the family that is actually named, not the one that was asked for.
   * Emitting Sarabun's 1.04 while rendering Noto's face would make text jump by
   * a px when the deferred font lands, on top of the typeface change.
   */
  it('uses the fallback family’s optical scale while the choice is pending', async () => {
    await setPreference({ fontFamily: 'sarabun' });
    const pending = await renderHook(() => useTypography(), {
      wrapper: wrapperFor([]),
    });
    const landed = await renderHook(() => useTypography(), {
      wrapper: wrapperFor(['sarabun']),
    });

    expect(pending.result.current({ size: 48 }).fontSize).toBe(
      Math.round(48 * FONT_FAMILIES.noto.opticalScale),
    );
    expect(landed.result.current({ size: 48 }).fontSize).toBe(
      Math.round(48 * FONT_FAMILIES.sarabun.opticalScale),
    );
  });
});

/**
 * The fourth cell of the grid: arbitrary preferences, style space.
 *
 * It is `typographyFor` in every respect except the OS division, and that one
 * difference is the whole reason it exists — so the tests below are written as
 * the two halves of that sentence. Everything about *which* numbers come out
 * is already pinned in `use-typography.test.ts` against the pure form; what
 * cannot be pinned there is a device.
 */
describe('usePreviewTypography', () => {
  it('resolves the preference it is handed, not the one that is stored', async () => {
    await setPreference({ fontSize: 'small', fontFamily: 'noto' });

    const view = await renderHook(() => usePreviewTypography(), {
      wrapper: wrapperFor(['sarabun']),
    });
    const preview = view.result.current(
      { fontSize: 'xlarge', fontFamily: 'sarabun' },
      { type: 'default' },
    );

    expect(preview).toEqual(
      typographyFor({ fontSize: 'xlarge', fontFamily: 'sarabun' }, { type: 'default' }, new Set([
        'sarabun',
      ])),
    );
  });

  /*
   * The bug the hook was added for. A `style` prop is multiplied by the OS
   * accessibility scale at paint, so a preview built from the dp form paints
   * the option larger than the app renders it — at 1.3, the `medium` card
   * showed 20.8 for a setting the app draws at 16.
   */
  it('divides the OS accessibility scale out, where the pure form cannot', async () => {
    mockOsFontScale.current = 1.3;

    const view = await renderHook(() => usePreviewTypography(), {
      wrapper: wrapperFor([]),
    });
    const emitted = view.result.current({ fontSize: 'medium', fontFamily: 'noto' }, { size: 16 });
    const dp = typographyFor({ fontSize: 'medium', fontFamily: 'noto' }, { size: 16 });

    expect(emitted.fontSize).toBe(Math.round(16 / 1.3));
    // RN multiplies it back, so the paint is the dp number the app renders.
    expect(Math.abs((emitted.fontSize as number) * 1.3 - (dp.fontSize as number))).toBeLessThan(1);
  });

  /*
   * The set comes from the context, not from a parameter the caller could
   * forget. A picker previewing a family the device has not registered names a
   * font that resolves to nothing and renders the OEM system face — the exact
   * state the family picker exists to let a user escape.
   */
  it('previews in noto for a family the device has not loaded', async () => {
    const view = await renderHook(() => usePreviewTypography(), {
      wrapper: wrapperFor([]),
    });

    expect(
      view.result.current({ fontSize: 'medium', fontFamily: 'sarabun' }, { size: 16 }).fontFamily,
    ).toBe(FONT_FAMILIES.noto.weights.medium);
  });
});
