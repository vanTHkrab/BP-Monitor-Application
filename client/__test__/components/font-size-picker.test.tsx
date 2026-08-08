/**
 * The font-size grid, and the one invariant that is the whole reason it is a
 * grid of samples rather than a row of labels.
 *
 * Each card renders "Aa" **at the size it selects**, read from
 * `FONT_SIZE_STEPS` — the same table `useTypography` derives its multiplier
 * from. client-old hardcoded its preview sizes separately from the sizes the
 * app actually used, so the preview could drift from the result. Re-hardcoding
 * them is a one-line regression that a render test which only checks the
 * labels would never see, which is why the sample sizes are asserted against
 * the table by name rather than against literals.
 *
 * ## The second invariant: the sample is in *style* space
 *
 * A `style` prop is multiplied by the OS accessibility scale at paint, so the
 * preview has to be divided by it first or the two compound and the card
 * overstates its own option. That state is invisible unless `fontScale` is
 * mocked — and jest-expo reports **2**, so these tests were running in exactly
 * the raised-scale state the bug lives in and asserting the compounded value
 * as correct. It is pinned to 1 below and varied deliberately in the last
 * block, following `src/hooks/use-tab-bar-geometry.test.tsx`.
 */
const mockOsFontScale = { current: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 2, fontScale: mockOsFontScale.current }),
}));

import { FontSizePicker } from '@/components/ui/font-size-picker';
import { FONT_SIZE_STEPS } from '@/theme/typography';
import { usePreferencesStore } from '@/stores';
import { renderScreen } from '../test-utils';

const LABELS = {
  small: 'เล็ก',
  medium: 'มาตรฐาน',
  large: 'ใหญ่',
  xlarge: 'ใหญ่มาก',
} as const;

beforeEach(() => {
  // The real store — the picker selects `fontSize` off it directly, and
  // `setFontSize` is not called by a render.
  usePreferencesStore.setState({ fontSize: 'medium', fontFamily: 'noto' });
  mockOsFontScale.current = 1;
});

describe('FontSizePicker', () => {
  it('offers all four rungs', async () => {
    const view = await renderScreen(<FontSizePicker />);

    for (const label of Object.values(LABELS)) {
      expect(view.getByText(label)).toBeOnTheScreen();
    }
  });

  it('selects exactly the stored preference', async () => {
    usePreferencesStore.setState({ fontSize: 'large' });
    const view = await renderScreen(<FontSizePicker />);

    expect(view.getByTestId('font-size-large')).toBeSelected();
    for (const other of ['small', 'medium', 'xlarge']) {
      expect(view.getByTestId(`font-size-${other}`)).not.toBeSelected();
    }
  });

  // The preview must be the real value by construction. Four cards, four
  // sizes, and the four "Aa" nodes are in the order the options are declared.
  it('renders each sample at the size that card selects', async () => {
    const view = await renderScreen(<FontSizePicker />);

    const samples = view.getAllByText('Aa');
    expect(samples).toHaveLength(4);

    const order = ['small', 'medium', 'large', 'xlarge'] as const;
    order.forEach((step, index) => {
      expect(samples[index].props.style).toMatchObject({
        fontSize: FONT_SIZE_STEPS[step],
      });
    });
  });

  it('shows the live sentence preview', async () => {
    const view = await renderScreen(<FontSizePicker />);

    expect(view.getByText('ตัวอย่างข้อความ')).toBeOnTheScreen();
    expect(
      view.getByText('ขนาดตัวอักษรนี้จะใช้กับหน้าหลัก ประวัติ ชุมชน และเมนูต่าง ๆ'),
    ).toBeOnTheScreen();
  });

  /*
   * The option *labels* scale with the current preference, not with the card
   * they sit on — so the four labels stay a consistent row while the samples
   * differ. Getting this backwards would make the grid a ladder of four
   * different label sizes, which is the thing the sample is supposed to be
   * doing.
   */
  it('keeps the four option labels at one size whatever is selected', async () => {
    usePreferencesStore.setState({ fontSize: 'xlarge' });
    const view = await renderScreen(<FontSizePicker />);

    const sizes = Object.values(LABELS).map(
      (label) => view.getByText(label).props.style.fontSize,
    );

    expect(new Set(sizes).size).toBe(1);
  });

  /*
   * The state the whole control is judged in, and the one no other test here
   * can see. `<Text allowFontScaling>` — the default — multiplies the OS
   * accessibility scale onto whatever `style.fontSize` says, so what the user
   * sees is `emitted × osScale`. A preview built from a dp number therefore
   * paints the option a third or a half larger than the app renders it, and a
   * control whose entire job is "this is what that setting looks like" is then
   * showing a size that exists nowhere in the app.
   *
   * Asserted through the paint, not through the emitted number: the emitted
   * number is an implementation detail of the division and `Math.round` makes
   * it awkward to state, while `emitted × osScale` is the thing on the glass.
   */
  describe('at a raised OS accessibility font size', () => {
    const order = ['small', 'medium', 'large', 'xlarge'] as const;

    it.each([1.3, 2])('paints each sample at its own rung (osScale %p)', async (osScale) => {
      mockOsFontScale.current = osScale;
      const view = await renderScreen(<FontSizePicker />);

      const samples = view.getAllByText('Aa');

      order.forEach((step, index) => {
        const painted = (samples[index].props.style.fontSize as number) * osScale;
        // Within a px: the resolver rounds to whole style px before RN
        // multiplies, so the round-trip cannot be exact and does not need to
        // be. What matters is that it tracks the rung instead of the rung
        // times the OS scale.
        expect(Math.abs(painted - FONT_SIZE_STEPS[step])).toBeLessThanOrEqual(1);
      });
    });

    /*
     * The regression stated as the bug rather than as the fix. Before this,
     * the sample fed `typographyFor` — dp — straight into a `style` prop, so
     * the emitted value *was* the rung and the paint was the rung × 2. jest-expo
     * reports `fontScale: 2` by default, which is why the version of this file
     * that shipped with the picker asserted the compounded number as correct.
     */
    it('does not emit the rung itself, which would compound', async () => {
      mockOsFontScale.current = 2;
      const view = await renderScreen(<FontSizePicker />);

      const samples = view.getAllByText('Aa');

      order.forEach((step, index) => {
        expect(samples[index].props.style.fontSize).not.toBe(FONT_SIZE_STEPS[step]);
      });
    });

    // The invariant from the block above, restated where it could break: the
    // division must not flatten four rungs into one.
    it('still previews four distinct sizes', async () => {
      mockOsFontScale.current = 1.3;
      const view = await renderScreen(<FontSizePicker />);

      const sizes = view.getAllByText('Aa').map((sample) => sample.props.style.fontSize);

      expect(new Set(sizes).size).toBe(4);
      expect([...sizes]).toEqual([...sizes].sort((a, b) => a - b));
    });
  });
});
