/**
 * Onboarding step 2 — display preferences.
 *
 * No network and no query, so there is no loading or error state to pin. What
 * this screen does have is *selection* state read from two different sources
 * — the colour scheme from `ColorSchemeProvider`, the font size from
 * `usePreferencesStore` — and the failure worth guarding is that a card shows
 * the wrong one as selected, which reads to the user as the setting not
 * having taken.
 *
 * The preferences store is the real one. It is a plain zustand store whose
 * only device dependency is AsyncStorage, which `jest.setup.js` already
 * replaces with the package's own in-memory mock — so seeding it via
 * `setState` exercises the screen against real selector code.
 */
import OnboardingSetupScreen from '@/app/onboarding/setup';
import { usePreferencesStore, type FontSizePreference } from '@/stores';
import { renderScreen } from '../test-utils';

beforeEach(() => {
  usePreferencesStore.setState({ fontSize: 'medium' });
});

describe('OnboardingSetupScreen', () => {
  it('offers every theme and every font size', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    for (const theme of ['light', 'dark', 'system']) {
      expect(view.getByTestId(`onboarding-theme-${theme}`)).toBeOnTheScreen();
    }
    for (const size of ['small', 'medium', 'large', 'xlarge']) {
      expect(view.getByTestId(`onboarding-font-${size}`)).toBeOnTheScreen();
    }
  });

  /*
   * `ColorSchemeProvider` is mounted by `renderScreen` with no storage, so it
   * starts on its own default. The assertion is that exactly one card claims
   * to be selected — a screen that marked none (or all) still renders fine
   * and still looks broken.
   */
  it('marks exactly one theme as the current one', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    const selected = ['light', 'dark', 'system'].filter(
      (theme) => view.getByTestId(`onboarding-theme-${theme}`).props.accessibilityState?.selected,
    );

    expect(selected).toHaveLength(1);
  });

  it.each<FontSizePreference>(['small', 'medium', 'large', 'xlarge'])(
    'marks %s as selected when that is the stored preference',
    async (size) => {
      usePreferencesStore.setState({ fontSize: size });
      const view = await renderScreen(<OnboardingSetupScreen />);

      expect(view.getByTestId(`onboarding-font-${size}`).props.accessibilityState?.selected).toBe(
        true,
      );
    },
  );

  // The preview is the only thing on the screen that shows what the setting
  // does. A preview that ignores the preference makes all four cards look the
  // same, which is how someone concludes the control is broken.
  it('renders the size preview', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    expect(view.getByText('ความดัน 120/80 · ชีพจร 72')).toBeOnTheScreen();
  });
});
