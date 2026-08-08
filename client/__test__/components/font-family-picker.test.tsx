/**
 * The typeface picker, and the two things that would quietly ruin it.
 *
 * 1. **A sample rendered in the current family instead of the card's own.**
 *    Then all three cards look identical and the control previews itself —
 *    the same failure `font-size-picker.test.tsx` guards against, and the
 *    reason both use `typographyFor` rather than `useTypography`.
 * 2. **`mono` appearing in the list.** It is Latin-only. Selecting it app-wide
 *    would drop every Thai string in the product to the OEM system font.
 *
 * Neither shows up in a render that only checks the labels, so both are
 * asserted against the resolved style and the registry rather than by eye.
 *
 * The third, added later: the sample goes into a `style` prop, which RN
 * multiplies by the OS accessibility scale at paint. It must therefore be
 * divided by that scale first, or the sample is shown at a size the app never
 * renders — milder than the size picker's version of this bug, since the
 * choice here is a typeface, but it puts the sample out of step with the
 * `label` description directly above it in the same card. jest-expo reports
 * `fontScale: 2`, so it is pinned to 1 here and varied deliberately at the end.
 */
const mockOsFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 2, fontScale: mockOsFontScale.current }),
}));

import { FontFamilyPicker } from '@/components/ui/font-family-picker';
import { usePreferencesStore } from '@/stores';
import { resolveFamilyWeight, typographyFor } from '@/hooks/use-typography';
import { LoadedFontFamiliesProvider } from '@/theme/font-loading';
import { FONT_FAMILIES, SELECTABLE_FONT_FAMILIES } from '@/theme/typography';
import { renderScreen } from '../test-utils';

const SAMPLE = 'ความดันที่วัดได้ 120/80';

/** Flattens what RN would actually apply. */
const styleOf = (node: { props: Record<string, unknown> }): Record<string, unknown> =>
  Object.assign({}, ...([node.props.style].flat(3).filter(Boolean) as object[]));

beforeEach(() => {
  usePreferencesStore.setState({ fontSize: 'medium', fontFamily: 'noto' });
  mockOsFontScale.current = 1;
});

describe('FontFamilyPicker', () => {
  it('offers every Thai-capable family', async () => {
    const view = await renderScreen(<FontFamilyPicker />);

    for (const id of SELECTABLE_FONT_FAMILIES) {
      expect(view.getByTestId(`font-family-${id}`)).toBeOnTheScreen();
      expect(view.getByText(FONT_FAMILIES[id].label)).toBeOnTheScreen();
    }
  });

  it('never offers the internal latin-only family', async () => {
    const view = await renderScreen(<FontFamilyPicker />);

    expect(view.queryByTestId('font-family-mono')).toBeNull();
    expect(view.queryByText(FONT_FAMILIES.mono.label)).toBeNull();
  });

  it('selects exactly the stored preference', async () => {
    usePreferencesStore.setState({ fontFamily: 'looped' });
    const view = await renderScreen(<FontFamilyPicker />);

    expect(view.getByTestId('font-family-looped')).toBeSelected();
    for (const id of SELECTABLE_FONT_FAMILIES.filter((other) => other !== 'looped')) {
      expect(view.getByTestId(`font-family-${id}`)).not.toBeSelected();
    }
  });

  /*
   * The invariant. Each card's sample must render in the face that card
   * selects — not in whatever is currently selected. Wrapped in a provider
   * that reports all three as loaded, because the default context reports only
   * Noto and the resolver would (correctly) fall everything back to it.
   */
  it('renders each sample in the family that card selects', async () => {
    const view = await renderScreen(
      <LoadedFontFamiliesProvider families={[...SELECTABLE_FONT_FAMILIES]}>
        <FontFamilyPicker />
      </LoadedFontFamiliesProvider>,
    );

    const samples = view.getAllByText(SAMPLE);
    expect(samples).toHaveLength(SELECTABLE_FONT_FAMILIES.length);

    SELECTABLE_FONT_FAMILIES.forEach((id, index) => {
      // The sample renders at `bodyLarge`, whose role weight is `medium` —
      // which only Noto ships, so the other two resolve through the fallback.
      expect({ id, family: styleOf(samples[index]).fontFamily }).toEqual({
        id,
        family: resolveFamilyWeight(id, 'medium'),
      });
    });

    // The strong form: three different faces, not three copies of one.
    const faces = samples.map((sample) => styleOf(sample).fontFamily);
    expect(new Set(faces).size).toBe(SELECTABLE_FONT_FAMILIES.length);
  });

  it('does not follow the current preference in its samples', async () => {
    usePreferencesStore.setState({ fontFamily: 'sarabun' });
    const view = await renderScreen(
      <LoadedFontFamiliesProvider families={[...SELECTABLE_FONT_FAMILIES]}>
        <FontFamilyPicker />
      </LoadedFontFamiliesProvider>,
    );

    const faces = view.getAllByText(SAMPLE).map((sample) => styleOf(sample).fontFamily);

    expect(new Set(faces).size).toBe(SELECTABLE_FONT_FAMILIES.length);
  });

  /*
   * Before the deferred fonts land, a sample must fall back to Noto rather
   * than name a font the device has not registered — that names nothing and
   * renders the OEM face, which is exactly the state this control is trying to
   * let the user escape. The default context reports Noto only, so no provider
   * is needed to reach it.
   */
  it('previews in noto while the families are still loading', async () => {
    const view = await renderScreen(<FontFamilyPicker />);

    const faces = view.getAllByText(SAMPLE).map((sample) => styleOf(sample).fontFamily);

    expect(new Set(faces)).toEqual(new Set([resolveFamilyWeight('noto', 'medium')]));
  });

  it('scales its samples with the current size preference', async () => {
    // Size is not what is being chosen here, so the samples show the user's
    // real size — a preview at a size they never asked for answers nothing.
    usePreferencesStore.setState({ fontSize: 'xlarge' });
    const view = await renderScreen(<FontFamilyPicker />);

    expect(styleOf(view.getAllByText(SAMPLE)[0]).fontSize).toBe(
      typographyFor({ fontSize: 'xlarge', fontFamily: 'noto' }, { type: 'bodyLarge' }).fontSize,
    );
  });

  /*
   * The same size at the paint, not at the style prop. `typographyFor` is dp;
   * this control writes a `style`, and the two spaces differ by exactly the OS
   * accessibility scale. Choosing a typeface at a size the app does not use is
   * a weaker failure than the size picker's, but it is the same one, and the
   * card's own description above the sample is resolved through the hook — so
   * getting this wrong puts two lines of one card in two different unit spaces.
   */
  it('paints its samples at the app size, not at the OS-compounded one', async () => {
    mockOsFontScale.current = 2;
    usePreferencesStore.setState({ fontSize: 'large' });
    const view = await renderScreen(<FontFamilyPicker />);

    const emitted = styleOf(view.getAllByText(SAMPLE)[0]).fontSize as number;
    const app = typographyFor({ fontSize: 'large', fontFamily: 'noto' }, { type: 'bodyLarge' })
      .fontSize as number;

    expect(Math.abs(emitted * 2 - app)).toBeLessThanOrEqual(1);
    // Stated as the bug too: emitting the dp number is what compounded.
    expect(emitted).not.toBe(app);
  });
});
