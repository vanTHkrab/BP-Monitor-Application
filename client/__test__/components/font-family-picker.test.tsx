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
 */
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
});
