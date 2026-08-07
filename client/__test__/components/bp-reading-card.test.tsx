/**
 * One reading in a list. Two rules here are subtler than they look and
 * neither is reachable from a screen test, because the history screen renders
 * one shape of reading.
 *
 * **Attribution has three cases, not two.** No `recordedById` means the owner
 * entered it and the line is omitted, which keeps the common case clean. A
 * `recordedById` equal to the *viewer* reads "คุณบันทึกให้" — a caregiver
 * looking at their own entry. Anyone else is named. Collapsing the middle
 * case tells a caregiver that someone else recorded a reading they took
 * themselves, on a screen whose purpose is knowing who touched the record.
 *
 * **A stuck reading is not a queued one.** `attempts >= 2` swaps the copy from
 * "ยังไม่ได้ซิงก์" to a failure the patient can act on. Before that split both
 * said "waiting" forever and the reason was written to a column no screen
 * read. One failed attempt is ordinary — the phone was in a lift; the
 * threshold is the whole design and an off-by-one either cries wolf or never
 * cries at all.
 */
import { BPReadingCard } from '@/modules/readings/components/bp-reading-card';
import type { Reading } from '@/modules/readings/types';
import { renderScreen } from '../test-utils';

const reading = (overrides: Partial<Reading> = {}): Reading => ({
  key: 'r1',
  userId: 'u1',
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: new Date('2026-08-07T09:00:00+07:00'),
  status: 'normal',
  createdAt: new Date('2026-08-07T09:00:00+07:00'),
  syncState: 'synced',
  ...overrides,
});

describe('BPReadingCard', () => {
  it('renders the pair, the pulse, and a spoken label of both', async () => {
    const view = await renderScreen(<BPReadingCard reading={reading()} />);

    expect(view.getByText('128')).toBeOnTheScreen();
    expect(view.getByText('82')).toBeOnTheScreen();
    expect(view.getByText('71 bpm')).toBeOnTheScreen();
    // The numerals are three separate `Text` nodes with a "/" between them, so
    // a screen reader gets "128 82" without this label.
    expect(view.getByTestId('reading-r1')).toHaveProp(
      'accessibilityLabel',
      '128 ทับ 82 มิลลิเมตรปรอท ชีพจร 71',
    );
  });

  describe('attribution', () => {
    it('says nothing when the owner recorded it', async () => {
      const view = await renderScreen(
        <BPReadingCard reading={reading()} currentUserId="u1" />,
      );

      expect(view.queryByText(/บันทึก/)).toBeNull();
    });

    it('says "คุณบันทึกให้" when the viewer is the one who recorded it', async () => {
      const view = await renderScreen(
        <BPReadingCard
          reading={reading({ recordedById: 'c1', recordedByName: 'สมหญิง' })}
          currentUserId="c1"
        />,
      );

      expect(view.getByText('คุณบันทึกให้')).toBeOnTheScreen();
    });

    it('names anyone else', async () => {
      const view = await renderScreen(
        <BPReadingCard
          reading={reading({ recordedById: 'c1', recordedByName: 'สมหญิง' })}
          currentUserId="u1"
        />,
      );

      expect(view.getByText('บันทึกโดย สมหญิง')).toBeOnTheScreen();
    });

    // The name can be missing where the id is not — a caregiver whose account
    // was deleted. "บันทึกโดย" with nothing after it reads as a rendering bug.
    it('falls back to a generic noun when the name is missing', async () => {
      const view = await renderScreen(
        <BPReadingCard reading={reading({ recordedById: 'c1' })} currentUserId="u1" />,
      );

      expect(view.getByText('บันทึกโดย ผู้ดูแล')).toBeOnTheScreen();
    });
  });

  describe('the sync badge', () => {
    it('is absent for a confirmed reading', async () => {
      const view = await renderScreen(<BPReadingCard reading={reading()} />);

      expect(view.queryByTestId('reading-r1-pending')).toBeNull();
    });

    it('says "waiting" for a queued reading that has not failed', async () => {
      const view = await renderScreen(
        <BPReadingCard reading={reading({ syncState: 'queued' })} />,
      );

      expect(view.getByTestId('reading-r1-pending')).toHaveTextContent('ยังไม่ได้ซิงก์');
    });

    // One failure is a lift, not a problem.
    it('still says "waiting" after a single failed attempt', async () => {
      const view = await renderScreen(
        <BPReadingCard reading={reading({ syncState: 'queued', attempts: 1 })} />,
      );

      expect(view.getByTestId('reading-r1-pending')).toHaveTextContent('ยังไม่ได้ซิงก์');
    });

    it('reports the failure and the count from the second attempt on', async () => {
      const view = await renderScreen(
        <BPReadingCard reading={reading({ syncState: 'queued', attempts: 2 })} />,
      );

      // `toHaveTextContent` is exact-match in RNTL, not a substring test as it
      // is in jest-dom — so this pins the count too, which is the actionable
      // half of the message.
      expect(view.getByTestId('reading-r1-pending')).toHaveTextContent(
        'ส่งไม่สำเร็จ · ลองแล้ว 2 ครั้ง',
      );
    });

    // `attempts` is optional on the type and absent on a row written before
    // the column existed. `>= 2` against `undefined` must not be true.
    it('treats a queued reading with no attempt count as waiting', async () => {
      const view = await renderScreen(
        <BPReadingCard reading={reading({ syncState: 'queued', attempts: undefined })} />,
      );

      expect(view.getByTestId('reading-r1-pending')).toHaveTextContent('ยังไม่ได้ซิงก์');
    });
  });

  describe('the timestamp', () => {
    it('is relative by default', async () => {
      const now = new Date();
      const view = await renderScreen(
        <BPReadingCard
          reading={reading({ measuredAt: new Date(now.getTime() - 3 * 60 * 60_000) })}
        />,
      );

      expect(view.getByText('3 ชั่วโมงที่แล้ว')).toBeOnTheScreen();
    });

    it('is a full date when the list asks for one', async () => {
      const now = new Date();
      const view = await renderScreen(
        <BPReadingCard
          reading={reading({ measuredAt: new Date(now.getTime() - 3 * 60 * 60_000) })}
          showFullDate
        />,
      );

      expect(view.queryByText('3 ชั่วโมงที่แล้ว')).toBeNull();
      expect(view.getByText(/น\.$/)).toBeOnTheScreen();
    });

    it('reads "เมื่อสักครู่" for a reading just taken', async () => {
      const view = await renderScreen(<BPReadingCard reading={reading({ measuredAt: new Date() })} />);

      expect(view.getByText('เมื่อสักครู่')).toBeOnTheScreen();
    });
  });

  // A card in a read-only list must not announce itself as a button, or a
  // screen-reader user spends the whole history screen tapping dead rows.
  describe('tappability', () => {
    it('is a button when it has somewhere to go', async () => {
      const view = await renderScreen(<BPReadingCard reading={reading()} onPress={() => {}} />);

      expect(view.getByTestId('reading-r1')).toHaveProp('accessibilityRole', 'button');
      expect(view.getByTestId('reading-r1')).not.toBeDisabled();
    });

    it('is inert when it does not', async () => {
      const view = await renderScreen(<BPReadingCard reading={reading()} />);

      expect(view.getByTestId('reading-r1').props.accessibilityRole).toBeUndefined();
    });
  });
});
