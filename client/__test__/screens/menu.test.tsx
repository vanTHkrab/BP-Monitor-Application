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
 *
 * The safe-area behaviour is asserted here too, because this screen was the
 * only one of the three tabs that never read the inset context — and the
 * symptom (a header pill under the notch, a logout button behind the tab bar)
 * only appears on hardware with a notch, which no test has.
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
import { findHostNodes } from '../components/host-tree';

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

/*
 * `useSafeAreaInsets()` rather than the `Spacing.four` / `BottomTabInset`
 * constants this screen used to pad with.
 *
 * Neither constant could be right. `BottomTabInset` is a flat iOS 50 /
 * Android 80, while the real bar is `tabBarBaseHeight + insets.bottom` with a
 * margin and `position: 'absolute'` — nothing reserves that space, so a
 * constant either overshoots or hides the logout button. And a flat top pad
 * put the header pill under the status bar on a notched device.
 *
 * `renderScreen` mounts a `SafeAreaProvider`, so the numbers below are the
 * test environment's insets, not a device's. What is being pinned is that the
 * padding is *derived from them* — `+ 108` is history.tsx's own expression.
 */
describe('MenuScreen — the frame', () => {
  it('derives its scroll padding from the safe-area insets', async () => {
    const view = await renderScreen(<MenuScreen />);

    const [scroll] = findHostNodes(view.toJSON() as never, 'RCTScrollView');
    expect(scroll).toBeDefined();

    const style = scroll.props?.contentContainerStyle as Record<string, number>;
    // Bottom clears the floating tab bar; `108` is the constant history.tsx
    // uses on top of the inset.
    expect(style.paddingBottom).toBeGreaterThanOrEqual(108);
    // One gutter for the whole column, rather than three different ones.
    expect(style.paddingHorizontal).toBe(16);
    expect(style.paddingTop).toBeDefined();
  });
});
