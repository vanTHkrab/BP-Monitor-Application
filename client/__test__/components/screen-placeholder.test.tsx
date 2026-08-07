/**
 * The stand-in for an unported screen. Its interesting branch is the back
 * affordance, which it decides for itself from `router.canGoBack()` rather
 * than from a prop — a tab screen is the initial route of its own tab and has
 * no back, a screen pushed from the menu has one and needs a visible way out
 * because this component deliberately rolls no native header.
 *
 * Getting that inverted strands the user on a dead-end screen with no gesture
 * back on Android. The condition is invisible to a screen test, because every
 * screen that mounts this happens to be pushed.
 */
/*
 * The factory declares the mock inline rather than closing over a `const`
 * above it: `jest.mock` is hoisted above every `const` in the file, so a
 * factory referencing one throws `Cannot read properties of undefined` at
 * module-eval — a failure that reads as though `expo-router` itself were
 * broken. The handle comes back through the import below instead.
 */
jest.mock('expo-router', () => ({
  router: { canGoBack: jest.fn(() => false), back: jest.fn() },
}));

import { router } from 'expo-router';

import { ScreenPlaceholder } from '@/components/screen-placeholder';
import { renderScreen } from '../test-utils';

const canGoBack = router.canGoBack as jest.Mock;

beforeEach(() => {
  canGoBack.mockReturnValue(false);
});

describe('ScreenPlaceholder', () => {
  it('renders the title', async () => {
    const view = await renderScreen(<ScreenPlaceholder title="รายงาน" />);

    expect(view.getByText('รายงาน')).toBeOnTheScreen();
  });

  it('renders the note and the source only when given them', async () => {
    const full = await renderScreen(
      <ScreenPlaceholder title="รายงาน" note="ยังไม่ได้พอร์ต" portedFrom="client-old/app/report.tsx" />,
    );
    expect(full.getByText('ยังไม่ได้พอร์ต')).toBeOnTheScreen();
    expect(full.getByText('client-old/app/report.tsx')).toBeOnTheScreen();

    const bare = await renderScreen(<ScreenPlaceholder title="รายงาน" />);
    expect(bare.queryByText('ยังไม่ได้พอร์ต')).toBeNull();
    expect(bare.queryByText('client-old/app/report.tsx')).toBeNull();
  });

  describe('the back affordance', () => {
    it('offers one on a pushed screen', async () => {
      canGoBack.mockReturnValue(true);
      const view = await renderScreen(<ScreenPlaceholder title="รายงาน" />);

      expect(view.getByLabelText('ย้อนกลับ')).toBeOnTheScreen();
    });

    // A tab's initial route. A back button here would either do nothing or
    // pop out of the tab entirely.
    it('offers none on a tab root', async () => {
      canGoBack.mockReturnValue(false);
      const view = await renderScreen(<ScreenPlaceholder title="รายงาน" />);

      expect(view.queryByLabelText('ย้อนกลับ')).toBeNull();
    });
  });
});
