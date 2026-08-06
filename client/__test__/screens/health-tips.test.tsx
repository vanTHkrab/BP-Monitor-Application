/**
 * Health tips screen — the wiring, not the copy.
 *
 * `modules/health-tips/lib/tips.test.ts` already proves the data and the icon
 * mapping. What a pure-logic test cannot see is whether the screen actually
 * maps over the list rather than rendering four hardcoded cards, and whether
 * the back control is reachable to someone using a screen reader. Those are
 * what is asserted here.
 *
 * Not a snapshot, for the same reason `settings.test.tsx` gives: a snapshot of
 * this screen pins every pastel icon chip and breaks on any spacing change.
 */
import { router } from 'expo-router';

// AsyncStorage's native module is absent under jest-expo, so the package's
// own in-memory mock stands in. Reached through `useFontScale` →
// `usePreferencesStore`.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

import HealthTipsScreen from '@/app/health-tips';
import { HEALTH_TIPS } from '@/modules/health-tips';
import { fireEvent, renderScreen } from '../test-utils';

beforeEach(() => {
  jest.clearAllMocks();
  // jest-expo leaves expo-router's imperative `router` real, so `back()` would
  // run against a navigator that does not exist here.
  jest.spyOn(router, 'back').mockImplementation(() => {});
});

describe('HealthTipsScreen', () => {
  it('renders the screen title', async () => {
    const view = await renderScreen(<HealthTipsScreen />);
    expect(view.getByText('เคล็ดลับการดูแลสุขภาพ')).toBeOnTheScreen();
  });

  it('renders a card for every bundled tip', async () => {
    const view = await renderScreen(<HealthTipsScreen />);
    for (const tip of HEALTH_TIPS) {
      expect(view.getByText(tip.title)).toBeOnTheScreen();
      expect(view.getByText(tip.description)).toBeOnTheScreen();
    }
  });

  it('renders exactly as many cards as there are tips', async () => {
    const view = await renderScreen(<HealthTipsScreen />);
    // Titles are the one string guaranteed unique per card, so counting them
    // catches a stray hardcoded card that the per-tip assertions above would
    // happily ignore.
    const titles = HEALTH_TIPS.map((tip) => tip.title);
    expect(view.getAllByText(new RegExp(titles.join('|')))).toHaveLength(titles.length);
  });

  it('exposes the back control to assistive tech and navigates back on press', async () => {
    const view = await renderScreen(<HealthTipsScreen />);
    await fireEvent.press(view.getByLabelText('ย้อนกลับ'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
