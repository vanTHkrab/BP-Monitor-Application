/**
 * The app-lock gate — draws a lock screen over the whole navigator once the
 * app has been backgrounded for real.
 *
 * The behaviour under test is the grace period: a brief backgrounding (a
 * notification shade, switching to read a text) must leave the app exactly
 * as it was, and only a stay longer than `BACKGROUND_GRACE_PERIOD_MS` (5
 * minutes) re-locks it.
 *
 * `AppState.addEventListener` is already `jest.fn()` under
 * `@react-native/jest-preset` (see its `jest/mocks/AppState.js`) — this
 * file only supplies an implementation that captures the registered
 * listener, rather than replacing the whole `react-native` module. Doing
 * that instead reliably crashed at import time: `react-native-css-interop`
 * pulls in `AppState`/`Appearance` at its own module scope
 * (`appearance-observables.ts`), and a `jest.mock('react-native', factory)`
 * that calls `jest.requireActual('react-native')` re-enters that resolution
 * while it is still being torn down.
 *
 * `promptDeviceUnlock` is mocked at the same boundary `use-app-lock.test.ts`
 * mocks `expo-local-authentication` at — this file is about the timing
 * decision, not about biometric prompting.
 */
const mockPromptDeviceUnlock = jest.fn();
jest.mock('@/modules/security/lib/app-lock', () => ({
  ...jest.requireActual('@/modules/security/lib/app-lock'),
  promptDeviceUnlock: (...args: unknown[]) => mockPromptDeviceUnlock(...args),
}));

import { AppState, Text } from 'react-native';

import { AppLockGate, useAppLockStore } from '@/modules/security';
import { act, renderScreen, waitFor } from '../test-utils';

const T0 = new Date('2026-08-17T09:00:00Z').getTime();
const FIVE_MINUTES_MS = 5 * 60 * 1000;

let mockAppStateHandler: ((state: string) => void) | undefined;

/** Fires the captured `AppState` listener, inside `act` so the store settles. */
const transitionTo = (state: string) => act(() => mockAppStateHandler?.(state));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  mockAppStateHandler = undefined;
  // `false` (not `true`): these tests are about the *lock* decision, not the
  // unlock flow. A resolved-`true` prompt calls `unlock()` on the same
  // microtask chain `attemptUnlock` kicks off, which would flip `unlocked`
  // back to `true` right after `lock()` set it `false` — a real race against
  // whatever this file asserts, not a meaningful pass. Resolving `false`
  // (an unsuccessful prompt) keeps a re-lock's `unlocked: false` observable
  // and stable.
  mockPromptDeviceUnlock.mockResolvedValue(false);

  // A cold start begins `active` — matches the mock's own default, made
  // explicit so this test does not depend on that default silently.
  (AppState as unknown as { currentState: string }).currentState = 'active';
  (AppState.addEventListener as jest.Mock).mockImplementation(
    (_event: string, handler: (state: string) => void) => {
      mockAppStateHandler = handler;
      return { remove: jest.fn() };
    },
  );

  // Merge, not replace — a replace would drop the store's actions along with
  // its state (same reasoning as `use-app-lock.test.ts`).
  useAppLockStore.setState({
    enabled: true,
    unlocked: true,
    capability: { available: true, kind: 'fingerprint', label: 'ลายนิ้วมือ' },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

async function renderGate() {
  return renderScreen(
    <AppLockGate>
      <Text testID="app-content">home</Text>
    </AppLockGate>,
  );
}

describe('AppLockGate — the background grace period', () => {
  it('leaves the app unlocked on a brief backgrounding, under the 5-minute grace period', async () => {
    await renderGate();

    await transitionTo('background');
    jest.setSystemTime(T0 + 4 * 60 * 1000); // 4 minutes away — still within grace
    await transitionTo('active');

    expect(useAppLockStore.getState().unlocked).toBe(true);
    expect(mockPromptDeviceUnlock).not.toHaveBeenCalled();
  });

  it('re-locks once the app has been away longer than 5 minutes', async () => {
    await renderGate();

    await transitionTo('background');
    jest.setSystemTime(T0 + 6 * 60 * 1000); // 6 minutes away — past the threshold
    await transitionTo('active');

    expect(useAppLockStore.getState().unlocked).toBe(false);
    await waitFor(() => expect(mockPromptDeviceUnlock).toHaveBeenCalledTimes(1));
  });

  // Pins the `>=` rather than `>`: exactly the threshold counts as expired,
  // not as still-grace.
  it('treats exactly 5 minutes away as expired', async () => {
    await renderGate();

    await transitionTo('background');
    jest.setSystemTime(T0 + FIVE_MINUTES_MS);
    await transitionTo('active');

    expect(useAppLockStore.getState().unlocked).toBe(false);
  });

  // A cold start reports no prior `background` transition at all — an
  // `active` event with nothing recorded before it must not lock, which is
  // what keeps the app from ever auto-prompting on launch.
  it('never locks from a cold start, with no prior backgrounding recorded', async () => {
    await renderGate();

    await transitionTo('active');

    expect(useAppLockStore.getState().unlocked).toBe(true);
    expect(mockPromptDeviceUnlock).not.toHaveBeenCalled();
  });

  // The grace period restarts on every fresh backgrounding — a long stay
  // followed by a short one must be judged on the short one, not remember
  // the earlier long absence.
  it('measures from the most recent backgrounding, not a stale earlier one', async () => {
    await renderGate();

    await transitionTo('background');
    jest.setSystemTime(T0 + 6 * 60 * 1000);
    await transitionTo('active');
    expect(useAppLockStore.getState().unlocked).toBe(false);

    // Unlock again, as a real return-from-lock-screen would, then background
    // briefly a second time.
    act(() => useAppLockStore.getState().unlock());
    await transitionTo('background');
    jest.setSystemTime(T0 + 6 * 60 * 1000 + 60 * 1000); // 1 minute this time
    await transitionTo('active');

    expect(useAppLockStore.getState().unlocked).toBe(true);
  });
});
