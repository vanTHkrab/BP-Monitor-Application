/**
 * The two signals the onboarding gate reads.
 *
 * Everything worth asserting here is about the **three-valued** `roleSelected`.
 * `true` sends the user on, `false` sends them to the role step, and `null`
 * means "do not decide yet" — and the only bug this hook can have is
 * collapsing the third into one of the first two. Reading `null` as `false`
 * puts the role step in front of a returning user for as long as `me` is in
 * flight, on every cold start. Reading it as `true` lets someone who never
 * chose straight into the app.
 *
 * The two sources are deliberately not one flag: the role is server state and
 * `setupCompleted` is device-local (see the hook header), so the tests below
 * move them independently and check neither is inferred from the other.
 *
 * `useSession` is replaced rather than driven through the store: this hook
 * reads `user` off it, and the real one would need a `me` query resolved
 * through the auth service to produce one. The readings module's
 * `__fixtures__/identity.ts` is deliberately **not** reused — its `TestUser`
 * has no `roleSelectedAt`, which is the only field this hook looks at.
 */
const mockSession: { isAuthenticated: boolean; user: { roleSelectedAt?: Date } | null } = {
  isAuthenticated: true,
  user: null,
};
jest.mock('@/modules/auth', () => ({
  useSession: () => ({
    status: mockSession.isAuthenticated ? 'authenticated' : 'unauthenticated',
    userId: mockSession.isAuthenticated ? 'u1' : null,
    isAuthenticated: mockSession.isAuthenticated,
    user: mockSession.user,
    isLoadingUser: false,
  }),
}));

import { act, renderHook } from '@testing-library/react-native';

import { resetPreferencesStore, usePreferencesStore } from '@/stores';

import { useOnboardingState } from './use-onboarding-state';

const CHOSE = { roleSelectedAt: new Date('2026-03-01T10:00:00.000Z') };
const NEVER_CHOSE = { roleSelectedAt: undefined };

const render = () => renderHook(() => useOnboardingState());

/** Both preference flags start `false` — see `preferences.store.ts` defaults. */
const setPreferences = (next: { setupCompleted?: boolean; hydrated?: boolean }) =>
  act(() => {
    usePreferencesStore.setState(next);
  });

beforeEach(() => {
  jest.clearAllMocks();
  resetPreferencesStore();
  mockSession.isAuthenticated = true;
  mockSession.user = CHOSE;
});

describe('roleSelected', () => {
  it('is null while nobody is signed in, not false', async () => {
    mockSession.isAuthenticated = false;
    mockSession.user = null;

    const view = await render();

    // A signed-out user has not *failed* to choose a role — there is nobody
    // to ask. `false` here would route the login screen to the role step.
    expect(view.result.current.roleSelected).toBeNull();
  });

  it('is null while `me` is still in flight for a signed-in user', async () => {
    mockSession.user = null;

    const view = await render();

    // The window between the token being restored and the profile landing.
    // The gate has to wait rather than treat "not loaded" as "not selected".
    expect(view.result.current.roleSelected).toBeNull();
  });

  it('is true once the profile carries a `roleSelectedAt`', async () => {
    const view = await render();

    expect(view.result.current.roleSelected).toBe(true);
  });

  it('is false for a loaded profile that never chose', async () => {
    mockSession.user = NEVER_CHOSE;

    const view = await render();

    // Not `null`: the answer is known here, and stalling would leave the
    // user on the splash forever.
    expect(view.result.current.roleSelected).toBe(false);
  });

  it('is a boolean, never the timestamp itself', async () => {
    const view = await render();

    // `Boolean(...)`, not the `Date`. The gate compares against `true` and
    // `null`, and a `Date` is neither — it would take the wrong branch of
    // every `=== true` in `route-gate.ts`.
    expect(typeof view.result.current.roleSelected).toBe('boolean');
  });

  it('does not follow the device-local setup flag', async () => {
    mockSession.user = NEVER_CHOSE;
    await setPreferences({ setupCompleted: true, hydrated: true });

    const view = await render();

    // The two are separate on purpose: a reinstall keeps the server-side
    // role and drops the device settings, so inferring either from the other
    // gets one of them wrong.
    expect(view.result.current.roleSelected).toBe(false);
    expect(view.result.current.appConfigured).toBe(true);
  });
});

describe('the device-local half', () => {
  it('reports the settings flag and the hydration flag separately', async () => {
    const view = await render();

    // Both false out of the box. `appConfigured: false` with
    // `preferencesHydrated: false` means "unknown", and the gate must not act
    // on it — which is only expressible because they are two fields.
    expect(view.result.current.appConfigured).toBe(false);
    expect(view.result.current.preferencesHydrated).toBe(false);
  });

  it('tracks a live change to the store without a remount', async () => {
    const view = await render();

    await setPreferences({ hydrated: true });
    expect(view.result.current.preferencesHydrated).toBe(true);
    expect(view.result.current.appConfigured).toBe(false);

    await setPreferences({ setupCompleted: true });
    // Subscribed, not sampled: hydration finishing after the gate has
    // rendered is the normal case at launch, and a snapshot read would leave
    // the splash up until something else happened to re-render.
    expect(view.result.current.appConfigured).toBe(true);
  });
});
