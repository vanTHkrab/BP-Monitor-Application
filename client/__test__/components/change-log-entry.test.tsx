/**
 * One line of the patient's audit trail — the screen whose entire purpose is
 * telling your own edits apart from a caregiver's.
 *
 * Two rules, both from the component's own docblock and both invisible in a
 * screenshot of the happy case:
 *
 *   - **Attribution reads `byPatient`, not an id comparison.** `actorId` is
 *     null once the actor's account is deleted, and `undefined !== myId`
 *     would silently re-attribute the patient's own old edits to a stranger.
 *   - **The actor is distinguished by wording as well as colour**, because
 *     "a colour alone fails for the part of this audience that cannot rely on
 *     one" — and this audience is elderly-first by design.
 *
 * The single row-level `accessibilityLabel` is the third: a screen reader
 * walking five fragments ("น้ำหนัก", "60 กก.", "→", …) loses the relationship
 * the layout carries, which on an oversight screen is the whole content.
 */
import { ChangeLogEntryRow } from '@/modules/caregivers/components/change-log-entry';
import type { ProfileChangeLogEntry } from '@/modules/caregivers/types';
import { renderScreen } from '../test-utils';

const entry = (overrides: Partial<ProfileChangeLogEntry> = {}): ProfileChangeLogEntry => ({
  id: 'e1',
  actorId: 'c1',
  actorName: 'สมหญิง',
  byPatient: false,
  field: 'weight',
  oldValue: '60',
  newValue: '58',
  changedAt: new Date('2026-08-07T09:00:00+07:00'),
  ...overrides,
});

describe('ChangeLogEntryRow', () => {
  it('names the field in Thai and shows both sides of the change', async () => {
    const view = await renderScreen(<ChangeLogEntryRow entry={entry()} testID="e1" />);

    expect(view.getByText('น้ำหนัก')).toBeOnTheScreen();
    expect(view.getByTestId('e1-old')).toHaveTextContent('60 กก.');
    expect(view.getByTestId('e1-new')).toHaveTextContent('58 กก.');
  });

  describe('attribution', () => {
    it('says the patient made the edit themselves', async () => {
      const view = await renderScreen(
        <ChangeLogEntryRow entry={entry({ byPatient: true })} testID="e1" />,
      );

      expect(view.getByText('คุณแก้ไขเอง')).toBeOnTheScreen();
    });

    it('names the caregiver otherwise', async () => {
      const view = await renderScreen(<ChangeLogEntryRow entry={entry()} testID="e1" />);

      expect(view.getByText('ผู้ดูแล คุณสมหญิง แก้ไขให้')).toBeOnTheScreen();
    });

    /*
     * The reason `byPatient` exists as a field rather than being derived. A
     * deleted caregiver's row keeps `actorName` and loses `actorId`; an
     * id-comparison implementation would flip this row's attribution. The
     * flag must win over the missing id.
     */
    it('still credits the patient when the actor id is gone', async () => {
      const view = await renderScreen(
        <ChangeLogEntryRow entry={entry({ byPatient: true, actorId: undefined })} testID="e1" />,
      );

      expect(view.getByText('คุณแก้ไขเอง')).toBeOnTheScreen();
      expect(view.queryByText(/ผู้ดูแล/)).toBeNull();
    });

    // Colour and wording both, not colour alone.
    it('tints the two actors differently as well as wording them differently', async () => {
      const colourOf = async (byPatient: boolean, text: string) => {
        const view = await renderScreen(
          <ChangeLogEntryRow entry={entry({ byPatient })} testID="e1" />,
        );
        // Flattened: `ThemedText` composes a className and a style, so
        // NativeWind hands the host node an array and `.style.color` is
        // `undefined` for both actors — a comparison that cannot fail.
        const style = view.getByText(text).props.style as
          | { color?: string }
          | { color?: string }[];
        const flat = (Array.isArray(style) ? style : [style]).filter(Boolean);
        return flat.map((layer) => layer?.color).filter(Boolean).at(-1);
      };

      const own = await colourOf(true, 'คุณแก้ไขเอง');
      const other = await colourOf(false, 'ผู้ดูแล คุณสมหญิง แก้ไขให้');

      expect(own).toBeDefined();
      expect(other).not.toBe(own);
    });
  });

  describe('values', () => {
    // "ยังไม่ได้ระบุ", not "—": this is a sentence about a person.
    it('spells out an empty side rather than dashing it', async () => {
      const view = await renderScreen(
        <ChangeLogEntryRow entry={entry({ oldValue: undefined })} testID="e1" />,
      );

      expect(view.getByTestId('e1-old')).toHaveTextContent('ยังไม่ได้ระบุ');
    });

    // A newer gateway can log a sixth field. The honest failure for an
    // oversight screen is "something called bloodType changed", not a
    // placeholder that hides it.
    it('falls back to the raw column name for a field it does not know', async () => {
      const view = await renderScreen(
        <ChangeLogEntryRow entry={entry({ field: 'bloodType', oldValue: 'A', newValue: 'B' })} testID="e1" />,
      );

      expect(view.getByText('bloodType')).toBeOnTheScreen();
      expect(view.getByTestId('e1-new')).toHaveTextContent('B');
    });
  });

  it('reads the whole change as one sentence for a screen reader', async () => {
    const view = await renderScreen(<ChangeLogEntryRow entry={entry()} testID="e1" />);

    expect(view.getByTestId('e1').props.accessibilityLabel).toMatch(
      /^น้ำหนัก เปลี่ยนจาก 60 กก\. เป็น 58 กก\. ผู้ดูแล คุณสมหญิง แก้ไขให้ เมื่อ /,
    );
  });
});
