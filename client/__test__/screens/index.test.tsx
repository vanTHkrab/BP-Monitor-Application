/**
 * The entry route — the only thing it does is decide where a launch lands.
 *
 * `resolveGate` is unit-tested in `modules/auth/route-gate.test.ts`, so this
 * file deliberately does not re-test the rule. What it pins is the *wiring*,
 * which that unit test cannot see: that the screen reads all four inputs from
 * the right places and hands the result to a declarative `<Redirect>` rather
 * than holding the spinner, and that `wait` renders the spinner rather than
 * falling through to a redirect. A screen that read `roleSelected` from the
 * wrong hook would pass every `route-gate` test and still send a returning
 * user through onboarding.
 *
 * `Redirect` is stubbed because expo-router's real one navigates against a
 * navigator that does not exist under the test renderer. The stub renders the
 * href as text, so the assertion is on the value the screen computed — not on
 * the fact that something was called.
 */
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  return {
    __esModule: true,
    Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
  };
});

const mockOnboarding = {
  current: {
    roleSelected: null as boolean | null,
    appConfigured: false,
    preferencesHydrated: false,
  },
};
jest.mock('@/modules/onboarding', () => ({
  useOnboardingState: () => mockOnboarding.current,
}));

import IndexRoute from '@/app/index';
import { useAuthStore } from '@/stores';
import { renderScreen } from '../test-utils';

/**
 * The spinner carries no testID and `ActivityIndicator` has no
 * `accessibilityRole`, so there is no query that reaches it. RNTL v14 removed
 * the `UNSAFE_getByType` escape hatch that used to cover this, so the tree is
 * walked by host-component name instead. Adding a testID to the screen would
 * be changing production code to make a test convenient.
 */
type RenderedNode = { type?: string; children?: unknown[] } | string | null;

function hasHostType(node: RenderedNode, type: string): boolean {
  if (!node || typeof node === 'string') return false;
  if (node.type === type) return true;
  return (node.children ?? []).some((child) => hasHostType(child as RenderedNode, type));
}

/** The store is the real one — the screen selects `status` off it directly. */
function setStatus(status: 'unknown' | 'authenticated' | 'unauthenticated') {
  useAuthStore.setState({ status });
}

beforeEach(() => {
  mockOnboarding.current = {
    roleSelected: true,
    appConfigured: true,
    preferencesHydrated: true,
  };
});

describe('IndexRoute', () => {
  /*
   * The waiting state is the whole reason this screen exists rather than a
   * `router.replace` in an effect. Collapsing it into a redirect is how a
   * returning user sees the login screen flash before their own data loads —
   * so "renders nothing but a spinner" is the assertion, and the absence of a
   * redirect is the half that matters.
   */
  it('holds on a spinner while the session is still unknown', async () => {
    setStatus('unknown');
    const view = await renderScreen(<IndexRoute />);

    expect(view.queryByTestId('redirect')).toBeNull();
    expect(hasHostType(view.toJSON() as RenderedNode, 'ActivityIndicator')).toBe(true);
  });

  // Signed in, but `me` has not answered yet. Treating "not loaded" as "not
  // selected" would restart onboarding for everyone on every cold start.
  it('holds on a spinner while the role is still unknown', async () => {
    setStatus('authenticated');
    mockOnboarding.current = {
      roleSelected: null,
      appConfigured: true,
      preferencesHydrated: true,
    };
    const view = await renderScreen(<IndexRoute />);

    expect(view.queryByTestId('redirect')).toBeNull();
  });

  // Preferences are read back from AsyncStorage; `setupCompleted` defaults to
  // false, so routing before hydration sends every returning user back to
  // first-run setup.
  it('holds on a spinner until local preferences have been read back', async () => {
    setStatus('authenticated');
    mockOnboarding.current = {
      roleSelected: true,
      appConfigured: true,
      preferencesHydrated: false,
    };
    const view = await renderScreen(<IndexRoute />);

    expect(view.queryByTestId('redirect')).toBeNull();
  });

  it('sends a signed-out launch to login', async () => {
    setStatus('unauthenticated');
    const view = await renderScreen(<IndexRoute />);

    expect(view.getByTestId('redirect')).toHaveTextContent('/login');
  });

  it('sends a signed-in user who has not picked a role to step one', async () => {
    setStatus('authenticated');
    mockOnboarding.current = {
      roleSelected: false,
      appConfigured: true,
      preferencesHydrated: true,
    };
    const view = await renderScreen(<IndexRoute />);

    expect(view.getByTestId('redirect')).toHaveTextContent('/onboarding/role');
  });

  it('sends a signed-in user who has not configured the device to step two', async () => {
    setStatus('authenticated');
    mockOnboarding.current = {
      roleSelected: true,
      appConfigured: false,
      preferencesHydrated: true,
    };
    const view = await renderScreen(<IndexRoute />);

    expect(view.getByTestId('redirect')).toHaveTextContent('/onboarding/setup');
  });

  it('sends a fully onboarded user into the app', async () => {
    setStatus('authenticated');
    const view = await renderScreen(<IndexRoute />);

    expect(view.getByTestId('redirect')).toHaveTextContent('/(tabs)');
  });
});
