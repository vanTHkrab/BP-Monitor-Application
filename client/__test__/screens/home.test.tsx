/**
 * Home screen — the behaviour a reader would want guaranteed.
 *
 * The data hooks are mocked rather than driven through SQLite. `useReadings`
 * is a `useLiveQuery` over expo-sqlite, which is a native module and cannot
 * run here; the layer underneath it is already covered against real
 * migrations in `modules/readings/repository/repository.test.ts` and the
 * merge is covered in `lib/mappers.test.ts`. What is left for this file is
 * what the *screen* decides: which of two mutually exclusive states to show,
 * whether the emergency button appears, and whether the badge tells the
 * truth.
 */
import { router } from 'expo-router';

jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

const mockUser = { current: { firstname: 'สมชาย', lastname: 'ใจดี', role: 'patient' } as
  | { firstname: string; lastname: string; role: string }
  | null };
jest.mock('@/modules/auth', () => ({
  useSession: () => ({ user: mockUser.current, userId: 'u1', isAuthenticated: true }),
}));

const mockActivePatient = {
  current: {
    patient: null as { id: string; firstname: string } | null,
    viewingPatientId: undefined as string | undefined,
    isViewingPatient: false,
  },
};
jest.mock('@/modules/caregivers', () => ({
  useActivePatient: () => mockActivePatient.current,
}));

const mockReadings = {
  latest: undefined as Record<string, unknown> | undefined,
  pendingCount: 0,
  isLoading: false,
};
const mockAlerts = { unreadCount: 0 };
const mockRefresh = jest.fn();

jest.mock('@/modules/readings', () => {
  const actual = jest.requireActual('@/modules/readings/components/latest-reading-card');
  const guidance = jest.requireActual('@/modules/readings/components/guidance-card');
  return {
    LatestReadingCard: actual.LatestReadingCard,
    GuidanceCard: guidance.GuidanceCard,
    useReadings: () => mockReadings,
    useAlerts: () => mockAlerts,
    useReadingsSync: () => ({ refresh: mockRefresh, isRefreshing: false, error: null }),
  };
});

import HomeScreen from '@/app/(tabs)/index';
import { fireEvent, renderScreen } from '../test-utils';

const reading = (over: Record<string, unknown> = {}) => ({
  key: 'client:c1',
  userId: 'u1',
  systolic: 128,
  diastolic: 82,
  pulse: 71,
  measuredAt: new Date('2026-07-29T08:00:00.000Z'),
  status: 'elevated',
  createdAt: new Date('2026-07-29T08:00:01.000Z'),
  syncState: 'synced',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(router, 'push').mockImplementation(() => {});
  mockUser.current = { firstname: 'สมชาย', lastname: 'ใจดี', role: 'patient' };
  mockActivePatient.current = {
    patient: null,
    viewingPatientId: undefined,
    isViewingPatient: false,
  };
  mockReadings.latest = undefined;
  mockReadings.pendingCount = 0;
  mockReadings.isLoading = false;
  mockAlerts.unreadCount = 0;
});

describe('HomeScreen', () => {
  it('greets the signed-in user', async () => {
    const view = await renderScreen(<HomeScreen />);

    expect(view.getByText('สวัสดี, คุณ สมชาย')).toBeTruthy();
  });

  describe('the latest reading', () => {
    it('renders the pair and its status', async () => {
      mockReadings.latest = reading();
      const view = await renderScreen(<HomeScreen />);

      expect(view.getByTestId('home-systolic')).toHaveTextContent('128');
      expect(view.getByTestId('home-diastolic')).toHaveTextContent('82');
      expect(view.getByTestId('home-status-pill')).toHaveTextContent(/ค่อนข้างสูง/);
    });

    // An empty card would read as "you have no readings" mid-load.
    it('says there is no data rather than rendering an empty card', async () => {
      const view = await renderScreen(<HomeScreen />);

      expect(view.getByTestId('home-no-readings')).toHaveTextContent(/ยังไม่มีข้อมูล/);
    });

    // A reading saved offline genuinely is not on the server. The patient
    // should learn that here, not from a caregiver who cannot see it.
    it('marks a reading that has not reached the server', async () => {
      mockReadings.latest = reading({ syncState: 'queued' });
      const view = await renderScreen(<HomeScreen />);

      expect(view.getByTestId('home-pending-badge')).toBeTruthy();
    });

    it('has no pending badge on a synced reading', async () => {
      mockReadings.latest = reading({ syncState: 'synced' });
      const view = await renderScreen(<HomeScreen />);

      expect(view.queryByTestId('home-pending-badge')).toBeNull();
    });

    it('reports how many readings are still queued', async () => {
      mockReadings.pendingCount = 3;
      const view = await renderScreen(<HomeScreen />);

      expect(view.getByTestId('home-pending-count')).toHaveTextContent(/3/);
    });
  });

  describe('guidance', () => {
    it('is absent until there is a reading to explain', async () => {
      const view = await renderScreen(<HomeScreen />);

      expect(view.queryByTestId('home-guidance')).toBeNull();
    });

    // The gating is what keeps "โทร 1669" from becoming the control people
    // learn to scroll past — it is on screen only when it is the answer.
    it.each([
      ['normal', false],
      ['elevated', false],
      ['low', false],
      ['high', true],
      ['critical', true],
    ])('shows the emergency call for %s: %s', async (status, expected) => {
      mockReadings.latest = reading({ status });
      const view = await renderScreen(<HomeScreen />);

      expect(view.queryByTestId('home-emergency-call') !== null).toBe(expected);
    });
  });

  describe('caregiver mode', () => {
    // Showing an empty reading card here would assert that the *patient* has
    // no readings — a claim about someone else's health, not about app state.
    it('asks a caregiver to pick a patient instead of showing a card', async () => {
      mockUser.current = { firstname: 'สมหญิง', lastname: 'ใจงาม', role: 'caregiver' };
      const view = await renderScreen(<HomeScreen />);

      expect(view.getByTestId('home-pick-patient')).toBeTruthy();
      expect(view.queryByTestId('home-latest-caption')).toBeNull();
      expect(view.queryByTestId('home-capture')).toBeNull();
    });

    it('shows the readings once a patient is selected', async () => {
      mockUser.current = { firstname: 'สมหญิง', lastname: 'ใจงาม', role: 'caregiver' };
      mockActivePatient.current = {
        patient: { id: 'p1', firstname: 'สมชาย' },
        viewingPatientId: 'p1',
        isViewingPatient: true,
      };
      mockReadings.latest = reading();
      const view = await renderScreen(<HomeScreen />);

      expect(view.queryByTestId('home-pick-patient')).toBeNull();
      expect(view.getByTestId('home-systolic')).toBeTruthy();
      expect(view.getByTestId('home-viewing-patient')).toHaveTextContent(/สมชาย/);
    });

    it('sends the caregiver to the invitations screen to choose', async () => {
      mockUser.current = { firstname: 'สมหญิง', lastname: 'ใจงาม', role: 'caregiver' };
      const view = await renderScreen(<HomeScreen />);

      fireEvent.press(view.getByTestId('home-pick-patient-action'));

      expect(router.push).toHaveBeenCalledWith('/invitations');
    });

    // A patient account must never see the caregiver branch, whatever the
    // store happens to hold.
    it('never shows the picker to a patient', async () => {
      const view = await renderScreen(<HomeScreen />);

      expect(view.queryByTestId('home-pick-patient')).toBeNull();
    });
  });

  describe('the notification bell', () => {
    it('has no badge when everything is read', async () => {
      const view = await renderScreen(<HomeScreen />);

      expect(view.queryByTestId('home-alerts-badge')).toBeNull();
    });

    it('shows the unread count', async () => {
      mockAlerts.unreadCount = 4;
      const view = await renderScreen(<HomeScreen />);

      expect(view.getByTestId('home-alerts-badge')).toHaveTextContent('4');
    });

    // Otherwise a two-digit count widens the badge past the bell it sits on.
    it('caps the badge at 9+', async () => {
      mockAlerts.unreadCount = 27;
      const view = await renderScreen(<HomeScreen />);

      expect(view.getByTestId('home-alerts-badge')).toHaveTextContent('9+');
    });
  });

  it.each([
    ['home-alerts', '/alerts'],
    ['home-capture', '/(tabs)/camera'],
    ['home-open-history', '/(tabs)/history'],
    ['home-open-reminders', '/reminders'],
  ])('navigates from %s to %s', async (testID, href) => {
    const view = await renderScreen(<HomeScreen />);

    fireEvent.press(view.getByTestId(testID));

    expect(router.push).toHaveBeenCalledWith(href);
  });
});
