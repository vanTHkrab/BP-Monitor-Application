/**
 * "ดูทั้งหมด" — the full-history list.
 *
 * The screen had no test because it had no decisions: it rendered every
 * reading, newest first. It has one now — the severity row — and with it the
 * three things worth pinning down. It gets severity and **not** a period,
 * because a time filter would contradict a screen titled "ประวัติทั้งหมด" and
 * duplicate a control the tab owns one tap away. The initial group arrives as
 * a route param, and this route is reachable by deep link, so the param is
 * untrusted input rather than a value the app handed itself.
 *
 * The grouping itself — which status lands in which pill — is covered as a
 * pure function in `modules/readings/lib/severity-filter.test.ts`. What is
 * left here is composition.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

const mockParams = { current: {} as Record<string, unknown> };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams.current,
}));

jest.mock('@/modules/auth', () => ({
  useSession: () => ({ userId: 'u1', isAuthenticated: true }),
}));

jest.mock('@/modules/caregivers', () => ({
  useActivePatient: () => ({ viewingPatientId: undefined, isViewingPatient: false }),
}));

jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

const mockReadings = { readings: [] as Record<string, unknown>[], isLoading: false };
jest.mock('@/modules/readings', () => ({
  ...jest.requireActual('@/modules/readings'),
  useReadings: () => mockReadings,
  useReadingsSync: () => ({ refresh: jest.fn(), isRefreshing: false, error: null }),
}));

import HistoryListScreen from '@/app/history-list';
import { fireEvent, renderScreen, waitFor } from '../test-utils';

const reading = (key: string, status: string) => ({
  key,
  userId: 'u1',
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: new Date('2026-07-29T08:00:00.000Z'),
  status,
  createdAt: new Date('2026-07-29T08:00:01.000Z'),
  syncState: 'synced',
});

const mixed = () => [
  reading('k-critical', 'critical'),
  reading('k-normal', 'normal'),
  reading('k-low', 'low'),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.current = {};
  mockReadings.readings = [];
  mockReadings.isLoading = false;
});

describe('HistoryListScreen', () => {
  it('offers severity and deliberately not a period', async () => {
    const view = await renderScreen(<HistoryListScreen />);

    ['all', 'normal', 'watch', 'alert'].forEach((key) => {
      expect(view.getByTestId(`history-list-severity-${key}`)).toBeTruthy();
    });
    // A period row here would contradict the screen's own title.
    expect(view.queryByTestId('history-list-filter-7days')).toBeNull();
  });

  it('shows everything until a group is chosen', async () => {
    mockReadings.readings = mixed();
    const view = await renderScreen(<HistoryListScreen />);

    expect(view.getByTestId('reading-k-critical')).toBeTruthy();
    expect(view.getByTestId('reading-k-normal')).toBeTruthy();
    expect(view.getByTestId('reading-k-low')).toBeTruthy();
  });

  it('narrows to the selected group', async () => {
    mockReadings.readings = mixed();
    const view = await renderScreen(<HistoryListScreen />);

    await fireEvent.press(view.getByTestId('history-list-severity-alert'));

    await waitFor(() => expect(view.queryByTestId('reading-k-normal')).toBeNull());
    expect(view.getByTestId('reading-k-critical')).toBeTruthy();
  });

  it('reaches a low reading, which no "high"-shaped grouping would', async () => {
    mockReadings.readings = mixed();
    const view = await renderScreen(<HistoryListScreen />);

    await fireEvent.press(view.getByTestId('history-list-severity-watch'));

    await waitFor(() => expect(view.getByTestId('reading-k-low')).toBeTruthy());
    expect(view.queryByTestId('reading-k-critical')).toBeNull();
  });

  describe('the route param', () => {
    // Continuity with the tab: arriving at a full-history list that quietly
    // dropped the group the user had just selected is the worse surprise.
    it('opens on the group the tab was showing', async () => {
      mockParams.current = { severity: 'alert' };
      mockReadings.readings = mixed();
      const view = await renderScreen(<HistoryListScreen />);

      expect(view.getByTestId('reading-k-critical')).toBeTruthy();
      expect(view.queryByTestId('reading-k-normal')).toBeNull();
    });

    // Deep-linkable, so not this app's to trust. Falling back to an empty list
    // would read as data loss.
    it.each([['nonsense'], [''], [undefined]])(
      'falls back to every level for %p rather than showing nothing',
      async (severity) => {
        mockParams.current = severity === undefined ? {} : { severity };
        mockReadings.readings = mixed();
        const view = await renderScreen(<HistoryListScreen />);

        expect(view.getByTestId('reading-k-normal')).toBeTruthy();
        expect(view.getByTestId('reading-k-low')).toBeTruthy();
      },
    );
  });

  describe('the empty state', () => {
    it('still says the history is empty when it is', async () => {
      const view = await renderScreen(<HistoryListScreen />);

      expect(view.getByTestId('history-list-empty')).toHaveTextContent(/ยังไม่มีการวัดที่บันทึกไว้/);
      expect(view.queryByTestId('history-list-severity-reset')).toBeNull();
    });

    // Severity is the only filter here, so it is unambiguously the culprit and
    // the copy names it rather than saying "ไม่พบรายการ".
    it('blames the severity filter when the history is not empty', async () => {
      mockReadings.readings = [reading('k-normal', 'normal')];
      const view = await renderScreen(<HistoryListScreen />);

      await fireEvent.press(view.getByTestId('history-list-severity-alert'));

      const empty = await view.findByTestId('history-list-empty');
      expect(empty).toHaveTextContent(/สูง\/สูงมาก/);
    });

    it('offers one tap back to every level', async () => {
      mockReadings.readings = [reading('k-normal', 'normal')];
      const view = await renderScreen(<HistoryListScreen />);

      await fireEvent.press(view.getByTestId('history-list-severity-alert'));
      await fireEvent.press(await view.findByTestId('history-list-severity-reset'));

      await waitFor(() => expect(view.getByTestId('reading-k-normal')).toBeTruthy());
    });

    it('does not claim an empty history while it is still loading', async () => {
      mockReadings.isLoading = true;
      const view = await renderScreen(<HistoryListScreen />);

      expect(view.getByTestId('history-list-empty')).toHaveTextContent(/กำลังโหลด/);
    });
  });

  describe('the count line', () => {
    it('says the total when nothing is filtered out', async () => {
      mockReadings.readings = mixed();
      const view = await renderScreen(<HistoryListScreen />);

      expect(view.getByText('ทั้งหมด 3 รายการ')).toBeTruthy();
    });

    // "ทั้งหมด 1 รายการ" over a filtered list would claim the user has one
    // reading in total, which is the one number this screen must not get wrong.
    it('says how many of how many once a group is chosen', async () => {
      mockReadings.readings = mixed();
      const view = await renderScreen(<HistoryListScreen />);

      await fireEvent.press(view.getByTestId('history-list-severity-alert'));

      expect(await view.findByText('1 จาก 3 รายการ')).toBeTruthy();
    });
  });
});
