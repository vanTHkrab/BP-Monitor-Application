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
 */
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
  usePreferencesStore.setState({ fontSize: 'medium' });
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
});
