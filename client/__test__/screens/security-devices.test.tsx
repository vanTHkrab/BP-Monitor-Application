/**
 * The device list — where someone goes to find out whether anyone else is in
 * their account.
 *
 * The states worth pinning are the two that share a node and the one that is
 * conditional on a count:
 *
 *  - Loading and empty are both `EmptyState`, distinguished only by
 *    `isLoading`. Saying "ยังไม่มีข้อมูลอุปกรณ์" during the first fetch tells
 *    a user nobody is signed in anywhere, which is the reassuring wrong
 *    answer.
 *  - The "sign out everything else" action appears only when there is
 *    something else. On one device it would sign out nothing and say it did.
 *
 * The revoked group is separate on purpose: a session that was ended is
 * history, not a threat, and mixing the two makes the active list unreadable.
 */
const mockSessions = {
  current: {
    sessions: [] as Record<string, unknown>[],
    isLoading: false,
    refetch: jest.fn(),
  },
};
jest.mock('@/modules/auth', () => ({
  useLoginSessions: () => mockSessions.current,
  useLogoutAllDevices: () => ({
    logoutAllDevices: jest.fn(),
    isPending: false,
  }),
}));

jest.mock('@/modules/security', () => ({
  ...jest.requireActual('@/modules/security'),
  SecurityHeader: () => null,
}));

import DevicesScreen from '@/app/security/devices';
import { renderScreen } from '../test-utils';

const session = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  deviceLabel: 'Pixel 8',
  isActive: true,
  lastActiveAt: new Date(),
  revokedAt: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSessions.current = { sessions: [], isLoading: false, refetch: jest.fn() };
});

describe('DevicesScreen', () => {
  it('says it is loading rather than saying no device is signed in', async () => {
    mockSessions.current.isLoading = true;
    const view = await renderScreen(<DevicesScreen />);

    expect(view.getByText('กำลังโหลดรายการอุปกรณ์…')).toBeOnTheScreen();
  });

  it('says there is nothing once the fetch has settled empty', async () => {
    const view = await renderScreen(<DevicesScreen />);

    expect(view.getByText('ยังไม่มีข้อมูลอุปกรณ์ ลองดึงหน้าจอลงเพื่อโหลดใหม่')).toBeOnTheScreen();
  });

  it('lists the active devices and counts them in the group title', async () => {
    mockSessions.current.sessions = [session(), session({ id: 's2', deviceLabel: 'iPad' })];
    const view = await renderScreen(<DevicesScreen />);

    expect(view.getByTestId('device-s1')).toBeOnTheScreen();
    expect(view.getByTestId('device-s2')).toBeOnTheScreen();
    expect(view.getByText('กำลังใช้งาน · 2 เครื่อง')).toBeOnTheScreen();
  });

  // A row with no name at all is indistinguishable from a rendering bug, and
  // the label is what the user recognises their own phone by.
  it('names an unlabelled device rather than rendering a blank row', async () => {
    mockSessions.current.sessions = [session({ deviceLabel: null })];
    const view = await renderScreen(<DevicesScreen />);

    expect(view.getByText('อุปกรณ์ไม่ทราบชื่อ')).toBeOnTheScreen();
  });

  it('keeps revoked sessions in their own group', async () => {
    mockSessions.current.sessions = [
      session(),
      session({
        id: 's9',
        deviceLabel: 'Old phone',
        isActive: false,
        revokedAt: new Date(),
      }),
    ];
    const view = await renderScreen(<DevicesScreen />);

    expect(view.getByText('ออกจากระบบแล้ว')).toBeOnTheScreen();
    expect(view.getByText('Old phone')).toBeOnTheScreen();
  });

  it('shows no revoked group when nothing has been revoked', async () => {
    mockSessions.current.sessions = [session()];
    const view = await renderScreen(<DevicesScreen />);

    expect(view.queryByText('ออกจากระบบแล้ว')).toBeNull();
  });

  describe('the sign-out-everything-else action', () => {
    /*
     * Gated on `active.length > 1`. With one device the only session it could
     * end is this one, which the button explicitly promises not to do — so it
     * would report success having done nothing.
     */
    it('is not offered when this is the only signed-in device', async () => {
      mockSessions.current.sessions = [session()];
      const view = await renderScreen(<DevicesScreen />);

      expect(view.queryByTestId('devices-logout-all')).toBeNull();
    });

    it('is offered once a second device is signed in', async () => {
      mockSessions.current.sessions = [session(), session({ id: 's2' })];
      const view = await renderScreen(<DevicesScreen />);

      expect(view.getByTestId('devices-logout-all')).toBeOnTheScreen();
      // States the exception up front, so nobody taps it expecting to be
      // signed out here too.
      expect(view.getByText('เครื่องนี้จะยังใช้งานต่อได้ตามปกติ')).toBeOnTheScreen();
    });

    // A revoked session is not something to sign out again.
    it('is not offered when the second device is already revoked', async () => {
      mockSessions.current.sessions = [session(), session({ id: 's2', isActive: false })];
      const view = await renderScreen(<DevicesScreen />);

      expect(view.queryByTestId('devices-logout-all')).toBeNull();
    });
  });
});
