/**
 * First-run display setup, now the app's first screen rather than its last
 * onboarding step.
 *
 * No network and no query, so there is no loading or error state to pin. What
 * this screen does have is *selection* state read from two different sources —
 * the colour scheme from `ColorSchemeProvider`, the font size and family from
 * `usePreferencesStore` — and the failure worth guarding is that a card shows
 * the wrong one as selected, which reads to the user as the setting not having
 * taken.
 *
 * The screen builds none of those controls itself any more: it renders the
 * same `SettingCard` + `ThemePicker` / `FontSizePicker` / `FontFamilyPicker`
 * that `app/settings.tsx` does, which is why the test IDs below are the
 * pickers' own (`theme-light`, `font-size-small`, `font-family-noto`) rather
 * than the `onboarding-*` ones this screen used to mint for its private copies.
 * That is the assertion that matters most here — the two screens had already
 * drifted on the label for the medium rung, and the only structural guard
 * against it happening again is that both go through one component.
 *
 * The preferences store is the real one. It is a plain zustand store whose
 * only device dependency is AsyncStorage, which `jest.setup.js` already
 * replaces with the package's own in-memory mock — so seeding it via
 * `setState` exercises the screen against real selector code.
 */
import { router } from 'expo-router';

import OnboardingSetupScreen from '@/app/onboarding/setup';
import { resolveGate } from '@/modules/auth/route-gate';
import { usePreferencesStore, type FontSizePreference } from '@/stores';
import { SELECTABLE_FONT_FAMILIES } from '@/theme/typography';
import { fireEvent, renderScreen, waitFor } from '../test-utils';

beforeEach(() => {
  usePreferencesStore.setState({
    fontSize: 'medium',
    fontFamily: 'noto',
    setupCompleted: false,
  });
  // jest-expo leaves expo-router's imperative `router` real, so a replace
  // would run against a navigator that does not exist here.
  jest.spyOn(router, 'replace').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('OnboardingSetupScreen', () => {
  it('offers every theme, every font size, and every selectable family', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    for (const theme of ['light', 'dark', 'system']) {
      expect(view.getByTestId(`theme-${theme}`)).toBeOnTheScreen();
    }
    for (const size of ['small', 'medium', 'large', 'xlarge']) {
      expect(view.getByTestId(`font-size-${size}`)).toBeOnTheScreen();
    }
    for (const family of SELECTABLE_FONT_FAMILIES) {
      expect(view.getByTestId(`font-family-${family}`)).toBeOnTheScreen();
    }
  });

  /*
   * `mono` is Latin-only. Offering it as the app-wide typeface would drop
   * every Thai string in the product to the OEM system font, so the picker
   * filters on `thai === 'full'` rather than on a hand-written list. Asserted
   * on the screen, not only on the component, because this is the surface a
   * first-run user meets before they can read anything else.
   */
  it('never offers the internal mono family', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    expect(view.queryByTestId('font-family-mono')).toBeNull();
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
      (theme) => view.getByTestId(`theme-${theme}`).props.accessibilityState?.selected,
    );

    expect(selected).toHaveLength(1);
  });

  it.each<FontSizePreference>(['small', 'medium', 'large', 'xlarge'])(
    'marks %s as selected when that is the stored preference',
    async (size) => {
      usePreferencesStore.setState({ fontSize: size });
      const view = await renderScreen(<OnboardingSetupScreen />);

      expect(view.getByTestId(`font-size-${size}`).props.accessibilityState?.selected).toBe(true);
    },
  );

  it('marks the stored font family as selected', async () => {
    usePreferencesStore.setState({ fontFamily: 'sarabun' });
    const view = await renderScreen(<OnboardingSetupScreen />);

    expect(view.getByTestId('font-family-sarabun').props.accessibilityState?.selected).toBe(true);
    expect(view.getByTestId('font-family-noto').props.accessibilityState?.selected).toBe(false);
  });

  // The previews are the only thing on the screen that shows what the settings
  // do. A preview that ignores the choice makes all the cards look the same,
  // which is how someone concludes the control is broken.
  it('renders a live sample for size and for family', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    expect(view.getAllByText('Aa')).toHaveLength(4);
    expect(view.getAllByText('ความดันที่วัดได้ 120/80')).toHaveLength(
      SELECTABLE_FONT_FAMILIES.length,
    );
  });
});

/**
 * Where "ถัดไป" goes, which is the part of the gate reorder a unit test on
 * `resolveGate` cannot reach.
 *
 * This step used to be the *last* onboarding screen — after login and after
 * role selection — so exiting to `/(tabs)` was correct and is now a bug that
 * type-checks. The user standing here may not be signed in at all, and the
 * screen has no way to know: the answer lives in `resolveGate`, and the only
 * way to consult it is to hand back to the entry route.
 *
 * A hardcoded `/(tabs)` would be a second copy of the routing rule, and the
 * copy a signed-out first-run user hits first.
 */
describe('OnboardingSetupScreen — finishing', () => {
  it('records that this device has been set up', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    await fireEvent.press(view.getByTestId('onboarding-setup-finish'));

    await waitFor(() => expect(usePreferencesStore.getState().setupCompleted).toBe(true));
  });

  it('hands back to the entry route rather than naming a destination', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    await fireEvent.press(view.getByTestId('onboarding-setup-finish'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    // The whole call list, not just "was called with `/`" — a screen that also
    // pushed `/(tabs)` would satisfy the positive assertion on its own.
    expect((router.replace as jest.Mock).mock.calls).toEqual([['/']]);
  });

  it.each(['/(tabs)', '/login', '/onboarding/role'])(
    'never routes straight to %s',
    async (href) => {
      const view = await renderScreen(<OnboardingSetupScreen />);

      await fireEvent.press(view.getByTestId('onboarding-setup-finish'));

      await waitFor(() => expect(router.replace).toHaveBeenCalled());
      expect(router.replace).not.toHaveBeenCalledWith(href);
    },
  );

  /*
   * The flag has to be written before the entry route re-runs the gate.
   * Reversed, `resolveGate` reads `appConfigured: false` and sends the user
   * straight back into the screen they just completed — a loop, not a slow
   * frame.
   */
  it('persists the flag before handing back, not after', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);
    // Read at the moment of navigation rather than after it: asserting the
    // flag afterwards passes either way, since both have happened by then.
    const flagWhenHandingBack: boolean[] = [];
    (router.replace as jest.Mock).mockImplementation(() => {
      flagWhenHandingBack.push(usePreferencesStore.getState().setupCompleted);
    });

    await fireEvent.press(view.getByTestId('onboarding-setup-finish'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(flagWhenHandingBack).toEqual([true]);
  });

  /**
   * The consequence of the whole reorder, composed rather than asserted twice.
   *
   * `route-gate.test.ts` proves the gate's answer for a given input;
   * the tests above prove the screen sets that input and asks the gate. This
   * puts the two together, because the thing a reviewer actually wants
   * guaranteed is the sentence "a first-run user who is not signed in reaches
   * login, not the tabs" — and neither test says that on its own.
   */
  it('lands a signed-out first-run user on login once the gate re-runs', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    await fireEvent.press(view.getByTestId('onboarding-setup-finish'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));

    expect(
      resolveGate({
        status: 'unauthenticated',
        roleSelected: null,
        appConfigured: usePreferencesStore.getState().setupCompleted,
        preferencesHydrated: true,
      }),
    ).toEqual({ kind: 'redirect', href: '/login' });
  });

  it('lands a signed-in user without a role on the role step', async () => {
    const view = await renderScreen(<OnboardingSetupScreen />);

    await fireEvent.press(view.getByTestId('onboarding-setup-finish'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));

    expect(
      resolveGate({
        status: 'authenticated',
        roleSelected: false,
        appConfigured: usePreferencesStore.getState().setupCompleted,
        preferencesHydrated: true,
      }),
    ).toEqual({ kind: 'redirect', href: '/onboarding/role' });
  });
});
