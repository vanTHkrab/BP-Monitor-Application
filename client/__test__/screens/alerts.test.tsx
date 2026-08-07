/**
 * Alerts — the notification list behind the home screen's bell.
 *
 * Three states share one node (`alerts-empty`): loading, empty, and the list
 * itself. That is worth pinning precisely because they share a node — a
 * regression that shows "ยังไม่มีการแจ้งเตือน" during the first fetch tells
 * the patient there is nothing wrong, which is the one wrong answer this
 * screen can give.
 *
 * The fourth state is the caregiver's. `canMarkRead` is false while viewing
 * someone else's alerts, and the whole "mark all read" affordance has to go
 * with it: the gateway scopes the mutation to the alert's owner, so the button
 * would either do nothing or — worse, if it ever started working — clear a
 * critical alert on behalf of the person it is about.
 */
const mockAlerts = {
  current: {
    alerts: [] as Record<string, unknown>[],
    unreadCount: 0,
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
    canMarkRead: true,
  },
};
const mockMarkAlertRead = jest.fn();
const mockMarkAllAlertsRead = jest.fn();

// Spread rather than replaced: the rows render through the real
// `statusColorFor` / `statusLabel`, so the "120/80 mmHg · <label>" assertion
// below is against the module that owns the wording rather than a stub of it.
jest.mock('@/modules/readings', () => ({
  ...jest.requireActual('@/modules/readings'),
  useAlerts: () => mockAlerts.current,
  useMarkAlertRead: () => ({ markAlertRead: mockMarkAlertRead }),
  useMarkAllAlertsRead: () => ({
    markAllAlertsRead: mockMarkAllAlertsRead,
    isPending: false,
  }),
}));

// `SecurityHeader` renders the patient banner, which reaches the caregivers
// module and the session. This file is about the list below it.
jest.mock('@/modules/security', () => ({
  SecurityHeader: () => null,
}));

import AlertsScreen from '@/app/alerts';
import { statusLabel } from '@/modules/readings';
import { renderScreen } from '../test-utils';

const alert = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  message: 'พบค่าความดันสูงกว่าปกติ',
  isRead: false,
  isAboutSomeoneElse: false,
  reading: { systolic: 150, diastolic: 95, status: 'high' },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAlerts.current = {
    alerts: [],
    unreadCount: 0,
    isLoading: false,
    isRefetching: false,
    refetch: jest.fn(),
    canMarkRead: true,
  };
});

describe('AlertsScreen', () => {
  it('says it is loading rather than saying there is nothing', async () => {
    mockAlerts.current.isLoading = true;
    const view = await renderScreen(<AlertsScreen />);

    // Full string, not a fragment: RNTL's `toHaveTextContent` matches the
    // whole content by default, and the empty-state copy starts with the same
    // words — a fragment match would pass against the wrong state.
    expect(view.getByTestId('alerts-empty')).toHaveTextContent('กำลังโหลดการแจ้งเตือน…');
  });

  it('says there is nothing once the fetch has settled empty', async () => {
    const view = await renderScreen(<AlertsScreen />);

    expect(view.getByTestId('alerts-empty')).toHaveTextContent(
      'ยังไม่มีการแจ้งเตือน ระบบจะแจ้งเมื่อพบค่าความดันที่ควรสังเกต',
    );
  });

  it('renders a row per alert instead of the empty state', async () => {
    mockAlerts.current.alerts = [alert(), alert({ id: 'a2', isRead: true })];
    const view = await renderScreen(<AlertsScreen />);

    expect(view.queryByTestId('alerts-empty')).toBeNull();
    expect(view.getByTestId('alert-a1')).toBeOnTheScreen();
    expect(view.getByTestId('alert-a2')).toBeOnTheScreen();
  });

  // The row exists to answer "what was the reading" without opening it. The
  // gateway embeds that snapshot specifically so this list needs one request.
  it('states the reading that triggered the alert', async () => {
    mockAlerts.current.alerts = [alert()];
    const view = await renderScreen(<AlertsScreen />);

    expect(view.getByText(`150/95 mmHg · ${statusLabel('high')}`)).toBeOnTheScreen();
  });

  it('marks only the unread rows with the dot', async () => {
    mockAlerts.current.alerts = [alert(), alert({ id: 'a2', isRead: true })];
    const view = await renderScreen(<AlertsScreen />);

    expect(view.getByTestId('alert-a1-unread')).toBeOnTheScreen();
    expect(view.queryByTestId('alert-a2-unread')).toBeNull();
  });

  describe('the unread banner', () => {
    it('is absent when everything has been read', async () => {
      mockAlerts.current.alerts = [alert({ isRead: true })];
      const view = await renderScreen(<AlertsScreen />);

      expect(view.queryByTestId('alerts-mark-all-read')).toBeNull();
    });

    it('counts the unread and offers to clear them', async () => {
      mockAlerts.current.alerts = [alert()];
      mockAlerts.current.unreadCount = 3;
      const view = await renderScreen(<AlertsScreen />);

      expect(view.getByText('ยังไม่ได้อ่าน 3 รายการ')).toBeOnTheScreen();
      expect(view.getByTestId('alerts-mark-all-read')).toBeOnTheScreen();
    });

    /*
     * The caregiver case. Read state belongs to the patient, so the count is
     * still reported — a caregiver wants to know — but the action is not
     * offered, and the subtitle says whose job it is instead of leaving a
     * button that silently does nothing.
     */
    it('reports the count but offers no action while viewing a patient', async () => {
      mockAlerts.current.alerts = [alert()];
      mockAlerts.current.unreadCount = 3;
      mockAlerts.current.canMarkRead = false;
      const view = await renderScreen(<AlertsScreen />);

      expect(view.getByText('ยังไม่ได้อ่าน 3 รายการ · ผู้ป่วยเป็นผู้อ่านเอง')).toBeOnTheScreen();
      expect(view.queryByTestId('alerts-mark-all-read')).toBeNull();
    });

    // Note: the rows are also left inert for a caregiver (`onPress` is
    // undefined when `canMarkRead` is false). That is only observable by
    // pressing one, which is an interaction test and out of scope for this
    // batch — recorded here so the gap is deliberate rather than missed.
  });
});
