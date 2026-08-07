/**
 * The menu tab — the profile card's three states, and the row list.
 *
 * The profile card is the only part of this screen with real states, and it
 * has three rather than the usual two: loading, loaded, and *loaded with no
 * user*. That third one is not a loading state and must not look like one —
 * a signed-in session whose `me` came back empty renders a card with an
 * avatar and no name, and "ไม่พบข้อมูลผู้ใช้" is the difference between the
 * user knowing something is wrong and the user waiting forever.
 *
 * The rows themselves are asserted as a set because they are the only way
 * into six screens. `menu.tsx`'s own comment says registering them all is
 * what keeps every row from being a dead link; a dropped row is a screen
 * nobody can reach, and it is invisible in review.
 */
const mockSession = {
  current: {
    user: null as Record<string, unknown> | null,
    isLoadingUser: false,
  },
};
jest.mock('@/modules/auth', () => ({
  useSession: () => mockSession.current,
  useLogout: () => ({ logout: jest.fn(), isPending: false }),
}));

import MenuScreen from '@/app/(tabs)/menu';
import { renderScreen } from '../test-utils';

const user = (over: Record<string, unknown> = {}) => ({
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  email: 'somchai@example.com',
  phone: '0812345678',
  ...over,
});

beforeEach(() => {
  mockSession.current = { user: user(), isLoadingUser: false };
});

describe('MenuScreen — the profile card', () => {
  it('names the signed-in user', async () => {
    const view = await renderScreen(<MenuScreen />);

    expect(view.getByText('สมชาย ใจดี')).toBeOnTheScreen();
    expect(view.getByText('somchai@example.com')).toBeOnTheScreen();
  });

  // Email is the identifier for a password sign-up, phone for the others.
  // Falling back is what keeps the card from reading as half-loaded.
  it('falls back to the phone number when there is no email', async () => {
    mockSession.current.user = user({ email: null });
    const view = await renderScreen(<MenuScreen />);

    expect(view.getByText('0812345678')).toBeOnTheScreen();
  });

  it('says it is loading while `me` is in flight', async () => {
    mockSession.current = { user: null, isLoadingUser: true };
    const view = await renderScreen(<MenuScreen />);

    expect(view.getByText('กำลังโหลดข้อมูลผู้ใช้...')).toBeOnTheScreen();
  });

  /*
   * The state that is easy to collapse into the loading one. A settled fetch
   * that returned no user is a problem the user should be told about, not a
   * spinner that never resolves.
   */
  it('says the user could not be found once the fetch has settled empty', async () => {
    mockSession.current = { user: null, isLoadingUser: false };
    const view = await renderScreen(<MenuScreen />);

    expect(view.getByText('ไม่พบข้อมูลผู้ใช้')).toBeOnTheScreen();
    expect(view.queryByText('กำลังโหลดข้อมูลผู้ใช้...')).toBeNull();
  });
});

describe('MenuScreen — the rows', () => {
  it('offers every menu destination', async () => {
    const view = await renderScreen(<MenuScreen />);

    for (const testID of [
      'menu-profile',
      'menu-invitations',
      'menu-settings',
      'menu-security',
      'menu-help',
      'menu-about',
      'menu-logout',
    ]) {
      expect(view.getByTestId(testID)).toBeOnTheScreen();
    }
  });

  /*
   * The debug row is gated on `__DEV__`, which jest leaves true — so this
   * asserts the dev side only. The production side cannot be reached without
   * reassigning a global the bundler inlines, and faking it here would assert
   * the fake rather than the build.
   */
  it('offers the debug row under a development build', async () => {
    expect(__DEV__).toBe(true);
    const view = await renderScreen(<MenuScreen />);

    expect(view.getByTestId('menu-debug')).toBeOnTheScreen();
  });
});
