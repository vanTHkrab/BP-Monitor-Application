/**
 * History screen — what the screen itself decides.
 *
 * The range arithmetic and the chart series are covered as pure functions in
 * `modules/readings/lib/time-filter.test.ts`, and the storage beneath
 * `useReadings` against real migrations in `repository.test.ts`. What is left
 * here is composition: which empty state appears and why, whether the preview
 * really is capped at three, and whether the caregiver gate holds.
 *
 * The chart is not asserted through the renderer. Its input is tested; how
 * `react-native-gifted-charts` draws it is that library's business.
 */
import { router } from 'expo-router';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

jest.mock('react-native-gifted-charts', () => ({
  LineChart: () => null,
}));

const mockUser = {
  current: { firstname: 'สมชาย', lastname: 'ใจดี', role: 'patient' } as {
    firstname: string;
    lastname: string;
    role: string;
  } | null,
};
jest.mock('@/modules/auth', () => ({
  useSession: () => ({ user: mockUser.current, userId: 'u1', isAuthenticated: true }),
}));

const mockActivePatient = {
  current: { viewingPatientId: undefined as string | undefined, isViewingPatient: false },
};
jest.mock('@/modules/caregivers', () => ({
  useActivePatient: () => mockActivePatient.current,
}));

const mockReadings = { readings: [] as Record<string, unknown>[], isLoading: false };

jest.mock('@/modules/readings', () => {
  const timeFilter = jest.requireActual('@/modules/readings/lib/time-filter');
  return {
    ...timeFilter,
    BPReadingCard: jest.requireActual('@/modules/readings/components/bp-reading-card')
      .BPReadingCard,
    BPTrendChart: jest.requireActual('@/modules/readings/components/bp-trend-chart')
      .BPTrendChart,
    useReadings: () => mockReadings,
    useReadingsSync: () => ({ refresh: jest.fn(), isRefreshing: false, error: null }),
  };
});

import HistoryScreen from '@/app/(tabs)/history';
import { fireEvent, renderScreen, waitFor } from '../test-utils';

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

const reading = (days: number, over: Record<string, unknown> = {}) => ({
  key: `k${days}`,
  userId: 'u1',
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: daysAgo(days),
  status: 'elevated',
  createdAt: daysAgo(days),
  syncState: 'synced',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(router, 'push').mockImplementation(() => {});
  mockUser.current = { firstname: 'สมชาย', lastname: 'ใจดี', role: 'patient' };
  mockActivePatient.current = { viewingPatientId: undefined, isViewingPatient: false };
  mockReadings.readings = [];
  mockReadings.isLoading = false;
});

describe('HistoryScreen', () => {
  it('renders the header and the four time filters', async () => {
    const view = await renderScreen(<HistoryScreen />);

    expect(view.getByText('ประวัติความดัน')).toBeTruthy();
    ['7days', '30days', '3months', '1year'].forEach((key) => {
      expect(view.getByTestId(`history-filter-${key}`)).toBeTruthy();
    });
  });

  describe('empty states', () => {
    // Three different situations that all render "no chart". Saying the same
    // thing for all of them sends the user looking for a bug that is not there.
    it('distinguishes "no readings at all" from "none in this range"', async () => {
      const view = await renderScreen(<HistoryScreen />);
      expect(view.getByTestId('history-empty')).toHaveTextContent(/ยังไม่มีการวัด/);

      mockReadings.readings = [reading(200)];
      const inRange = await renderScreen(<HistoryScreen />);
      expect(inRange.getByTestId('history-empty')).toHaveTextContent(/ไม่มีการวัดในช่วงเวลานี้/);
    });

    it('says it is loading rather than claiming there is nothing', async () => {
      mockReadings.isLoading = true;
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('history-empty')).toHaveTextContent(/กำลังโหลด/);
    });
  });

  describe('the range filter', () => {
    it('excludes readings older than the selected range', async () => {
      mockReadings.readings = [reading(2), reading(200)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('reading-k2')).toBeTruthy();
      expect(view.queryByTestId('reading-k200')).toBeNull();
    });

    it('brings older readings back when the range widens', async () => {
      mockReadings.readings = [reading(2), reading(200)];
      const view = await renderScreen(<HistoryScreen />);

      fireEvent.press(view.getByTestId('history-filter-1year'));

      // `waitFor`, not a bare assertion: RNTL v14 renders concurrently, so
      // the re-render from this state change has not flushed synchronously.
      await waitFor(() => expect(view.getByTestId('reading-k200')).toBeTruthy());
    });
  });

  describe('the preview list', () => {
    it('shows at most three readings', async () => {
      mockReadings.readings = [reading(1), reading(2), reading(3), reading(4)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('reading-k1')).toBeTruthy();
      expect(view.getByTestId('reading-k3')).toBeTruthy();
      expect(view.queryByTestId('reading-k4')).toBeNull();
    });

    it('offers "ดูทั้งหมด" only when something is hidden', async () => {
      mockReadings.readings = [reading(1), reading(2), reading(3)];
      const exactlyThree = await renderScreen(<HistoryScreen />);
      expect(exactlyThree.queryByTestId('history-view-all')).toBeNull();

      mockReadings.readings = [reading(1), reading(2), reading(3), reading(4)];
      const fourOfThem = await renderScreen(<HistoryScreen />);
      expect(fourOfThem.getByTestId('history-view-all')).toHaveTextContent(/4 รายการ/);
    });

    it('opens a reading by its key, so a queued one is reachable too', async () => {
      mockReadings.readings = [reading(1, { key: 'client:c1', syncState: 'queued' })];
      const view = await renderScreen(<HistoryScreen />);

      fireEvent.press(view.getByTestId('reading-client:c1'));

      expect(router.push).toHaveBeenCalledWith('/reading/client%3Ac1');
    });

    it('marks a queued reading in the list', async () => {
      mockReadings.readings = [reading(1, { syncState: 'queued' })];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('reading-k1-pending')).toBeTruthy();
    });
  });

  describe('caregiver mode', () => {
    it('gates the whole screen until a patient is chosen', async () => {
      mockUser.current = { firstname: 'สมหญิง', lastname: 'ใจงาม', role: 'caregiver' };
      mockReadings.readings = [reading(1)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.getByTestId('history-pick-patient')).toBeTruthy();
      expect(view.queryByTestId('history-filter-7days')).toBeNull();
      expect(view.queryByTestId('reading-k1')).toBeNull();
    });

    it('shows the history once a patient is selected', async () => {
      mockUser.current = { firstname: 'สมหญิง', lastname: 'ใจงาม', role: 'caregiver' };
      mockActivePatient.current = { viewingPatientId: 'p1', isViewingPatient: true };
      mockReadings.readings = [reading(1)];
      const view = await renderScreen(<HistoryScreen />);

      expect(view.queryByTestId('history-pick-patient')).toBeNull();
      expect(view.getByTestId('reading-k1')).toBeTruthy();
    });

    it('never gates a patient account', async () => {
      const view = await renderScreen(<HistoryScreen />);

      expect(view.queryByTestId('history-pick-patient')).toBeNull();
    });
  });
});
