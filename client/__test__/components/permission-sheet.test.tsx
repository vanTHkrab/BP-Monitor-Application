/**
 * "สิทธิ์ของผู้ดูแล" — where a patient changes what an accepted caregiver may do.
 *
 * This is consent UI, and `lib/permission.ts` says so in as many words: the
 * `consequence` sentences "**are** the consent UI; they are not a summary of
 * it". `full` was widened to cover editing health information without adding a
 * new level, and what makes that defensible is that the patient can downgrade
 * — which only works if both options, and what each costs them, are on screen
 * at once. `permission.test.ts` covers the table; nothing covered the sheet
 * that renders it, so a sheet showing only the selected option would ship
 * green.
 *
 * What is pinned:
 *
 *   - both options rendered, always, with their full consequence sentences —
 *     the unchosen one is how a patient discovers the choice exists;
 *   - which one reads as selected, in both directions, so the check is proven
 *     to discriminate;
 *   - the in-flight lock, likewise in both directions.
 *
 * **A Tamagui modal `Sheet` keeps its content mounted while closed**, so
 * `open={false}` is not a hiding assertion this component can support and none
 * is attempted — `export-format-sheet.test.tsx` records the same property.
 */
import { PermissionSheet } from '@/modules/caregivers/components/permission-sheet';
import { PERMISSION_OPTIONS } from '@/modules/caregivers/lib/permission';

import { renderScreen } from '../test-utils';

const noop = () => {};

const props = {
  open: true,
  onOpenChange: noop,
  caregiverName: 'คุณสมชาย',
  current: 'view' as const,
  onSelect: noop,
};

describe('PermissionSheet', () => {
  it('names the caregiver the choice is about', async () => {
    const view = await renderScreen(<PermissionSheet {...props} />);

    expect(view.getByText('สิทธิ์ของผู้ดูแล')).toBeOnTheScreen();
    expect(view.getByText('คุณสมชาย จะทำอะไรกับข้อมูลของคุณได้บ้าง')).toBeOnTheScreen();
  });

  /*
   * Driven off `PERMISSION_OPTIONS` rather than hard-coded copy: the point is
   * that the sheet renders *whatever the shared table says*, so a third option
   * added there without a sheet change would be caught, and a wording change
   * in one place would not need editing in two. The exact sentences are the
   * table's own test to own.
   */
  it('renders every option with its full consequence, whichever is selected', async () => {
    const view = await renderScreen(<PermissionSheet {...props} />);

    expect(PERMISSION_OPTIONS.length).toBeGreaterThan(1);
    for (const option of PERMISSION_OPTIONS) {
      expect(view.getByTestId(`permission-sheet-${option.value}`)).toBeOnTheScreen();
      expect(view.getByText(option.label)).toBeOnTheScreen();
      expect(view.getByText(option.consequence)).toBeOnTheScreen();
    }
  });

  // The weaker grant has to be visible from the stronger one, or a patient who
  // granted `full` can never discover they may downgrade.
  it('still shows the weaker option when the stronger one is granted', async () => {
    const view = await renderScreen(<PermissionSheet {...props} current="full" />);

    expect(view.getByText('ดูอย่างเดียว')).toBeOnTheScreen();
    expect(view.getByText('บันทึกแทนได้')).toBeOnTheScreen();
  });

  /*
   * Selection is announced through `accessibilityState.checked` on a `radio`.
   *
   * Read as a prop rather than through `toBeChecked()`: that matcher rejects
   * these rows with "works only on host Switch instances or accessible
   * instance with checkbox, radio or switch role", because it additionally
   * requires `accessible` to be true and Tamagui's `XStack` does not set it —
   * the role and the state are both present on the node. (`toHaveAccessibility
   * State` is not an option either; it does not exist in RNTL v14.)
   *
   * Both rows are asserted in each direction, so this is shown to discriminate
   * rather than being vacuously true of a row that never sets the state.
   */
  it('marks exactly the granted permission as chosen', async () => {
    const checkedOf = (view: { getByTestId: (id: string) => { props: Record<string, unknown> } }, id: string) =>
      (view.getByTestId(id).props.accessibilityState as { checked?: boolean } | undefined)?.checked;

    const onView = await renderScreen(<PermissionSheet {...props} current="view" />);
    expect(checkedOf(onView, 'permission-sheet-view')).toBe(true);
    expect(checkedOf(onView, 'permission-sheet-full')).toBe(false);

    const onFull = await renderScreen(<PermissionSheet {...props} current="full" />);
    expect(checkedOf(onFull, 'permission-sheet-full')).toBe(true);
    expect(checkedOf(onFull, 'permission-sheet-view')).toBe(false);
  });

  it('presents the rows as radio options', async () => {
    const view = await renderScreen(<PermissionSheet {...props} />);

    for (const option of PERMISSION_OPTIONS) {
      expect(view.getByTestId(`permission-sheet-${option.value}`)).toHaveProp(
        'accessibilityRole',
        'radio',
      );
    }
  });

  /*
   * The write happens on tap with no confirm step, so a second tap while the
   * mutation is in flight sends a second grant change. `isPending` is the only
   * guard, and it defaults to `false` — which means the default-parameter trap
   * applies: passing `isPending={undefined}` explicitly would silently get the
   * default, so the enabled case is written by omitting the prop entirely.
   */
  describe('while a change is in flight', () => {
    it('locks both rows', async () => {
      const view = await renderScreen(<PermissionSheet {...props} isPending />);

      expect(view.getByTestId('permission-sheet-view')).toBeDisabled();
      expect(view.getByTestId('permission-sheet-full')).toBeDisabled();
      // `toBeDisabled()` reads `accessibilityState`; the prop is what actually
      // stops the press handler, so both halves are worth pinning.
      expect(view.getByTestId('permission-sheet-view')).toHaveProp('disabled', true);
    });

    it('leaves them tappable otherwise', async () => {
      const view = await renderScreen(<PermissionSheet {...props} />);

      expect(view.getByTestId('permission-sheet-view')).not.toBeDisabled();
      expect(view.getByTestId('permission-sheet-full')).not.toBeDisabled();
      expect(view.getByTestId('permission-sheet-view')).toHaveProp('disabled', false);
    });

    // The dimming is the visible half of the lock — without it the rows look
    // tappable and the patient taps again.
    it('dims them', async () => {
      const pending = await renderScreen(<PermissionSheet {...props} isPending />);
      const idle = await renderScreen(<PermissionSheet {...props} />);

      const opacityOf = (view: typeof pending, testID: string) =>
        (view.getByTestId(testID).props.style as { opacity?: number }).opacity;

      expect(opacityOf(pending, 'permission-sheet-view')).toBeDefined();
      expect(opacityOf(idle, 'permission-sheet-view')).toBeDefined();
      expect(opacityOf(pending, 'permission-sheet-view')).toBeLessThan(
        opacityOf(idle, 'permission-sheet-view') as number,
      );
    });
  });

  // The label and the consequence are two separate `Paragraph`s on screen; a
  // screen reader lands on the row, not on either of them, so the row has to
  // carry both or half the consent text is unreachable.
  it('puts the whole consequence in each row accessibility label', async () => {
    const view = await renderScreen(<PermissionSheet {...props} />);

    for (const option of PERMISSION_OPTIONS) {
      expect(view.getByTestId(`permission-sheet-${option.value}`)).toHaveProp(
        'accessibilityLabel',
        `${option.label} — ${option.consequence}`,
      );
    }
  });
});
