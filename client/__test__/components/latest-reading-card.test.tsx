/**
 * The home screen's hero card. Its empty state carries two different
 * messages behind one testID — "กำลังโหลด..." while the query is in flight
 * and "ยังไม่มีข้อมูล" once it has answered with nothing.
 *
 * Collapsing them is the bug that tells a brand-new patient their app is
 * broken, or tells a returning one they have no readings while the fetch is
 * still running. Both render the same node, so nothing about the markup
 * distinguishes them — only the copy does.
 */
import { LatestReadingCard } from '@/modules/readings/components/latest-reading-card';
import type { Reading } from '@/modules/readings/types';
import { renderScreen } from '../test-utils';

const reading = (overrides: Partial<Reading> = {}): Reading => ({
  key: 'r1',
  userId: 'u1',
  systolic: 152,
  diastolic: 96,
  pulse: 88,
  measuredAt: new Date('2026-08-07T09:00:00+07:00'),
  status: 'high',
  createdAt: new Date('2026-08-07T09:00:00+07:00'),
  syncState: 'synced',
  ...overrides,
});

describe('LatestReadingCard', () => {
  describe('with no reading', () => {
    it('says it is still loading while the query is in flight', async () => {
      const view = await renderScreen(<LatestReadingCard isLoading />);

      expect(view.getByTestId('home-no-readings')).toHaveTextContent('กำลังโหลด...');
    });

    it('says there is nothing once the query has answered', async () => {
      const view = await renderScreen(<LatestReadingCard />);

      expect(view.getByTestId('home-no-readings')).toHaveTextContent('ยังไม่มีข้อมูล');
    });

    it('shows a dash where the date would be, rather than an empty caption', async () => {
      const view = await renderScreen(<LatestReadingCard />);

      expect(view.getByTestId('home-latest-caption')).toHaveTextContent('ผลการวัดล่าสุด -');
    });

    it('renders none of the reading furniture', async () => {
      const view = await renderScreen(<LatestReadingCard />);

      expect(view.queryByTestId('home-systolic')).toBeNull();
      expect(view.queryByTestId('home-status-pill')).toBeNull();
      expect(view.queryByTestId('home-pending-badge')).toBeNull();
    });
  });

  describe('with a reading', () => {
    it('renders the pair', async () => {
      const view = await renderScreen(<LatestReadingCard reading={reading()} />);

      expect(view.getByTestId('home-systolic')).toHaveTextContent('152');
      expect(view.getByTestId('home-diastolic')).toHaveTextContent('96');
      expect(view.getByText('88 bpm')).toBeOnTheScreen();
    });

    /*
     * The status is spelled out next to its colour rather than encoded in it.
     * That is a medical judgement on a card an elderly user reads at a glance,
     * and roughly 8% of men cannot read a red/green pill — so the *word* is
     * the assertion, not the tint.
     */
    it('spells the status out in words as well as colour', async () => {
      const view = await renderScreen(<LatestReadingCard reading={reading({ status: 'high' })} />);

      expect(view.getByTestId('home-status-pill')).toHaveTextContent('สถานะ: ความดันสูง');
    });

    it('changes the word with the status', async () => {
      const view = await renderScreen(<LatestReadingCard reading={reading({ status: 'normal' })} />);

      expect(view.getByTestId('home-status-pill')).toHaveTextContent('สถานะ: ปกติ');
    });

    // A reading saved offline genuinely is not on the server yet, and the
    // patient should learn that here rather than from a caregiver saying they
    // cannot see it.
    it('flags a reading that has not reached the server', async () => {
      const view = await renderScreen(
        <LatestReadingCard reading={reading({ syncState: 'queued' })} />,
      );

      expect(view.getByTestId('home-pending-badge')).toBeOnTheScreen();
    });

    it('does not flag a confirmed one', async () => {
      const view = await renderScreen(<LatestReadingCard reading={reading()} />);

      expect(view.queryByTestId('home-pending-badge')).toBeNull();
    });

    it('names the caregiver who took it, when one did', async () => {
      const view = await renderScreen(
        <LatestReadingCard reading={reading({ recordedByName: 'สมหญิง' })} />,
      );

      expect(view.getByText('บันทึกโดยคุณสมหญิง')).toBeOnTheScreen();
    });

    it('says nothing about attribution when the patient took it themselves', async () => {
      const view = await renderScreen(<LatestReadingCard reading={reading()} />);

      expect(view.queryByText(/บันทึกโดย/)).toBeNull();
    });

    it('dates the caption', async () => {
      const view = await renderScreen(<LatestReadingCard reading={reading()} />);

      expect(view.getByTestId('home-latest-caption')).toHaveTextContent(/^ผลการวัดล่าสุด .+ น\.$/);
    });
  });
});
