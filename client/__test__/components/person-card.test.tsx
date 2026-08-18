/**
 * One linked person, as a card.
 *
 * The rule worth pinning is spatial and it is a safety one, stated twice in
 * the source: the remove button keeps its **own hit box, outside** the open
 * target, "so 'view' and 'unlink' are never one mis-tap apart". Unlinking a
 * caregiver is destructive and not undoable from this screen — the person has
 * to be re-invited and re-accept.
 *
 * A test cannot measure hit boxes, but it can pin the two things that make
 * the separation real: two distinct testIDs, and two distinct accessible
 * names. A refactor that folds the remove button inside the open Pressable
 * loses neither, so this is asserted as what it is — the naming contract, not
 * the geometry — and the geometry is called out here rather than claimed.
 */
import { PersonCard } from '@/modules/caregivers/components/person-card';
import { renderScreen } from '../test-utils';

const noop = () => {};

const props = {
  firstname: 'สมหญิง',
  lastname: 'รักดี',
  name: 'คุณสมหญิง รักดี',
  detail: '0898765432',
  testID: 'person-1',
};

describe('PersonCard', () => {
  it('renders the name and the secondary identifier', async () => {
    const view = await renderScreen(<PersonCard {...props} />);

    expect(view.getByText('คุณสมหญิง รักดี')).toBeOnTheScreen();
    expect(view.getByText('0898765432')).toBeOnTheScreen();
  });

  describe('the two actions', () => {
    it('offers neither by default', async () => {
      const view = await renderScreen(<PersonCard {...props} />);

      expect(view.queryByTestId('person-1-open')).toBeNull();
      expect(view.queryByTestId('person-1-remove')).toBeNull();
    });

    it('gives each its own control and its own name', async () => {
      const view = await renderScreen(
        <PersonCard {...props} onOpen={noop} onRemove={noop} removeLabel="ยกเลิกการเชื่อมโยงกับ" />,
      );

      expect(view.getByTestId('person-1-open')).toHaveProp(
        'accessibilityLabel',
        'ดูข้อมูลของ คุณสมหญิง รักดี',
      );
      expect(view.getByTestId('person-1-remove')).toHaveProp(
        'accessibilityLabel',
        'ยกเลิกการเชื่อมโยงกับ คุณสมหญิง รักดี',
      );
    });

    it('takes an overriding open label', async () => {
      const view = await renderScreen(
        <PersonCard {...props} onOpen={noop} openLabel="เปิดประวัติของ" />,
      );

      expect(view.getByTestId('person-1-open')).toHaveProp(
        'accessibilityLabel',
        'เปิดประวัติของ คุณสมหญิง รักดี',
      );
    });
  });

  describe('chips', () => {
    it('renders none when there are none', async () => {
      const view = await renderScreen(<PersonCard {...props} />);

      expect(view.queryByText('ดูอย่างเดียว')).toBeNull();
    });

    it('renders a plain chip as a label, not a control', async () => {
      const view = await renderScreen(
        <PersonCard {...props} chips={[{ label: 'ลูก' }]} />,
      );

      expect(view.getByText('ลูก')).toBeOnTheScreen();
      expect(view.queryByRole('button', { name: 'ลูก' })).toBeNull();
    });

    /*
     * A chip with `onPress` becomes its own control and gains a pencil — the
     * thing you tap to change a grant is the chip already stating it. Without
     * the button role a screen-reader user has no way to discover that the
     * permission is editable at all.
     */
    it('makes a chip with a handler an announced button', async () => {
      const view = await renderScreen(
        <PersonCard
          {...props}
          chips={[
            {
              label: 'ดูและบันทึก',
              tone: 'accent',
              onPress: noop,
              accessibilityLabel: 'เปลี่ยนสิทธิ์ของ คุณสมหญิง',
              testID: 'person-1-permission',
            },
          ]}
        />,
      );

      expect(view.getByTestId('person-1-permission')).toHaveProp('accessibilityRole', 'button');
      expect(view.getByTestId('person-1-permission')).toHaveProp(
        'accessibilityLabel',
        'เปลี่ยนสิทธิ์ของ คุณสมหญิง',
      );
    });

    /*
     * Regression test for C-009 (see TASK.md): a `Pressable` whose `style` is
     * the function form (`({ pressed }) => ...`) silently drops a sibling
     * `className`, which is what turned this chip into a small, mis-shapen
     * box — background colour present, but no padding, border width,
     * rounding, or row layout. The fix carries every one of those through
     * the same function-form `style` instead of `className`, so this asserts
     * the resolved style directly rather than trusting a class name to have
     * resolved.
     */
    it('lays itself out with its own style, not a className the Pressable might drop', async () => {
      const view = await renderScreen(
        <PersonCard
          {...props}
          chips={[
            {
              label: 'ดูและบันทึก',
              tone: 'accent',
              onPress: noop,
              testID: 'person-1-permission',
            },
          ]}
        />,
      );

      expect(view.getByTestId('person-1-permission')).toHaveStyle({
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 9999,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 4,
      });
    });

    /*
     * White text on `colors.accent` (`#FF8A45`) measures ~2.3:1 contrast —
     * under WCAG AA's 4.5:1 floor. Asserts the label is not white rather than
     * pinning the exact replacement hex, so a future palette adjustment only
     * fails this test if it regresses back to something illegible.
     */
    it('keeps the accent chip label readable against its own background', async () => {
      const view = await renderScreen(
        <PersonCard
          {...props}
          chips={[{ label: 'ดูและบันทึก', tone: 'accent', onPress: noop }]}
        />,
      );

      expect(view.getByText('ดูและบันทึก')).not.toHaveStyle({ color: '#FFFFFF' });
    });

    it('falls back to the chip text when no label is given', async () => {
      const view = await renderScreen(
        <PersonCard {...props} chips={[{ label: 'ดูอย่างเดียว', onPress: noop, testID: 'chip' }]} />,
      );

      expect(view.getByTestId('chip')).toHaveProp('accessibilityLabel', 'ดูอย่างเดียว');
    });

    it('renders several chips together', async () => {
      const view = await renderScreen(
        <PersonCard {...props} chips={[{ label: 'ลูก' }, { label: 'ดูและบันทึก', tone: 'accent' }]} />,
      );

      expect(view.getByText('ลูก')).toBeOnTheScreen();
      expect(view.getByText('ดูและบันทึก')).toBeOnTheScreen();
    });
  });
});
