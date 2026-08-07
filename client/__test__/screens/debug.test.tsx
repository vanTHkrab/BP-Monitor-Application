/**
 * Debug — a `ScreenPlaceholder`, and the point of the test is to record that.
 *
 * The screen itself is *not* dev-gated. Only the menu row that reaches it is
 * (`__DEV__` in `app/(tabs)/menu.tsx`), so the route renders identically under
 * `NODE_ENV=test` and there is no environment branch to pin here.
 *
 * The one branch that does exist belongs to `ScreenPlaceholder`, not to this
 * screen: it renders a back affordance only when `router.canGoBack()` is true.
 * Both sides are asserted because a placeholder pushed from the menu with no
 * tab bar under it and no back button is a dead end — the exact failure the
 * component's own comment says the branch exists to avoid.
 */
import { router } from 'expo-router';

import DebugScreen from '@/app/debug';
import { renderScreen } from '../test-utils';

beforeEach(() => {
  jest.restoreAllMocks();
});

describe('DebugScreen', () => {
  it('renders the placeholder with its title and source pointer', async () => {
    jest.spyOn(router, 'canGoBack').mockReturnValue(false);
    const view = await renderScreen(<DebugScreen />);

    expect(view.getByText('Debug · ข้อมูลในแอป')).toBeOnTheScreen();
    // Named so the next session does not have to search for the real content.
    expect(view.getByText('client-old/app/debug/')).toBeOnTheScreen();
  });

  // Pushed from the menu, so there is no tab bar to fall back to. Without
  // this the screen is unreachable in reverse.
  it('offers a way back when there is somewhere to go back to', async () => {
    jest.spyOn(router, 'canGoBack').mockReturnValue(true);
    const view = await renderScreen(<DebugScreen />);

    expect(view.getByLabelText('ย้อนกลับ')).toBeOnTheScreen();
  });

  it('renders no back affordance when this is the root of the stack', async () => {
    jest.spyOn(router, 'canGoBack').mockReturnValue(false);
    const view = await renderScreen(<DebugScreen />);

    expect(view.queryByLabelText('ย้อนกลับ')).toBeNull();
  });
});
