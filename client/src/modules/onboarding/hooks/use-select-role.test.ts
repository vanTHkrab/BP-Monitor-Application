/**
 * The onboarding role step.
 *
 * The cache write is the exit condition, not a nicety. `use-onboarding-state`
 * reads `roleSelectedAt` off the `me` query and the route gate bounces anyone
 * without it, so a hook that navigated on without writing `['me']` would send
 * the user forward and the gate would send them straight back — a loop with no
 * error anywhere to explain it. That is what the cache assertions below hold.
 *
 * `formatAuthError` is the **real** one, not a stub: what is worth asserting
 * is which Thai string a user actually sees, and a mocked formatter would let
 * this file pass while the screen shows English. The auth barrel loads under
 * jest because `jest.setup.js` stubs google-signin and AsyncStorage globally.
 *
 * The error is local `useState`, not `mutation.error` — so unlike the auth
 * mutation hooks it settles inside the same `act` as the call, and `onMutate`
 * gives it a second life: it must be gone again the moment a retry starts,
 * or the banner from the previous attempt sits over a request in flight.
 */
const mockSelectRole = jest.fn();
jest.mock('../services/onboarding-api', () => ({
  selectRole: (...args: unknown[]) => mockSelectRole(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import type { User } from '@/modules/auth';
import { ApiError } from '@/services/api-error';

import type { SelectableRole } from '../types';
import { useSelectRole } from './use-select-role';

const CHOSE_CAREGIVER: User = {
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  emailVerified: false,
  role: 'caregiver',
  roleSelectedAt: new Date('2026-03-01T10:00:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

/** What the cache holds before the step: a role, but never a choice. */
const NEVER_CHOSE: User = { ...CHOSE_CAREGIVER, role: 'patient', roleSelectedAt: undefined };

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderSelectRole = () => renderHook(() => useSelectRole(), { wrapper });

async function choose(
  view: Awaited<ReturnType<typeof renderSelectRole>>,
  role: SelectableRole = 'caregiver',
): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.selectRole(role);
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  // `clearAllMocks` clears the call log but not implementations, and leaves a
  // `mockRejectedValueOnce` queue for the next test to consume.
  mockSelectRole.mockReset();
  mockSelectRole.mockResolvedValue(CHOSE_CAREGIVER);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('the request', () => {
  it('sends the chosen role and nothing else', async () => {
    const view = await renderSelectRole();
    await choose(view, 'patient');

    expect(mockSelectRole).toHaveBeenCalledWith('patient');
    expect(mockSelectRole).toHaveBeenCalledTimes(1);
  });
});

describe('the cached user afterwards', () => {
  it('carries the `roleSelectedAt` the gate reads, not just the new role', async () => {
    client.setQueryData(['me'], NEVER_CHOSE);

    const view = await renderSelectRole();
    await choose(view);

    const cached = client.getQueryData<User>(['me']);
    // `role` alone cannot answer the gate's question: it defaults to
    // `patient`, so "chose patient" and "never chose" are the same value —
    // see the comment on `User.roleSelectedAt`. The timestamp is the answer.
    expect(cached?.roleSelectedAt).toEqual(CHOSE_CAREGIVER.roleSelectedAt);
    expect(cached).toEqual(CHOSE_CAREGIVER);
  });

  it('populates `me` even when nothing had cached it yet', async () => {
    const view = await renderSelectRole();
    await choose(view);

    // The screen can be reached before `useSession`'s query has resolved.
    // Writing only when an entry exists would leave the gate with nothing.
    expect(client.getQueryData<User>(['me'])).toEqual(CHOSE_CAREGIVER);
  });

  it('does not mark `me` stale, so the gate is not racing a refetch', async () => {
    client.setQueryData(['me'], NEVER_CHOSE);

    const view = await renderSelectRole();
    await choose(view);

    expect(client.getQueryState(['me'])?.isInvalidated).toBe(false);
  });

  it('leaves the un-chosen user in place when the write fails', async () => {
    client.setQueryData(['me'], NEVER_CHOSE);
    mockSelectRole.mockRejectedValue(new Error('boom'));

    const view = await renderSelectRole();
    await choose(view);

    // An optimistic `roleSelectedAt` here would let the gate through on a
    // choice the server never recorded, and the next cold start would put
    // the user back on this screen with no explanation.
    expect(client.getQueryData<User>(['me'])).toEqual(NEVER_CHOSE);
  });
});

describe('when it fails', () => {
  it('shows the step own Thai fallback for an English transport failure', async () => {
    mockSelectRole.mockRejectedValue(new Error('Network request failed'));

    const view = await renderSelectRole();
    await choose(view);

    expect(view.result.current.error).toEqual({
      message: 'บันทึกบทบาทไม่สำเร็จ กรุณาลองใหม่',
      field: null,
      retryAfterSec: null,
    });
  });

  it('passes the gateway own Thai message through, minus the log prefix', async () => {
    mockSelectRole.mockRejectedValue(
      new ApiError('[BAD_USER_INPUT] เลือกบทบาทซ้ำไม่ได้', { code: 'BAD_USER_INPUT' }),
    );

    const view = await renderSelectRole();
    await choose(view);

    expect(view.result.current.error?.message).toBe('เลือกบทบาทซ้ำไม่ได้');
  });

  it('replaces a raw English gateway message rather than showing it', async () => {
    mockSelectRole.mockRejectedValue(
      new ApiError('[BAD_USER_INPUT] role must be one of patient, caregiver', {
        code: 'BAD_USER_INPUT',
      }),
    );

    const view = await renderSelectRole();
    await choose(view);

    // The invariant `lib/errors.ts` exists to hold: raw English never
    // reaches the UI.
    expect(view.result.current.error?.message).toBe('ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
  });

  it('still rejects, so the screen does not navigate on', async () => {
    const cause = new ApiError('[FORBIDDEN] no', { code: 'FORBIDDEN', httpStatus: 403 });
    mockSelectRole.mockRejectedValue(cause);

    const view = await renderSelectRole();

    // `mutateAsync` rejecting is what stops the caller's `router.replace`
    // running after a failed choice. Formatting the error for display does
    // not mean swallowing it.
    expect(await choose(view)).toBe(cause);
  });

  it('clears the banner on dismiss', async () => {
    mockSelectRole.mockRejectedValue(new Error('boom'));

    const view = await renderSelectRole();
    await choose(view);
    expect(view.result.current.error).not.toBeNull();

    await act(async () => {
      view.result.current.clearError();
    });

    expect(view.result.current.error).toBeNull();
  });

  it('clears the previous banner before the retry, not after it resolves', async () => {
    mockSelectRole.mockRejectedValueOnce(new Error('boom'));

    const view = await renderSelectRole();
    await choose(view);
    expect(view.result.current.error).not.toBeNull();

    // Observed *while the retry is in flight*, by holding the request open
    // and asserting from the test across an `act` boundary — sampling
    // `result.current` from inside the mock would read the last committed
    // render, which is the one before `onMutate` ran. An `onSuccess`-only
    // reset would leave the old failure on screen for the whole round trip,
    // which no assertion taken after the call has settled can see.
    let release: (user: User) => void = () => {};
    mockSelectRole.mockImplementationOnce(
      () =>
        new Promise<User>((resolve) => {
          release = resolve;
        }),
    );

    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = view.result.current.selectRole('patient');
    });

    expect(view.result.current.error).toBeNull();
    expect(view.result.current.isPending).toBe(true);

    await act(async () => {
      release(CHOSE_CAREGIVER);
      await pending;
    });

    expect(view.result.current.error).toBeNull();
    // `waitFor`: `isPending` comes from TanStack, which notifies observers
    // through its own batching timer a tick after the promise settles —
    // unlike `error`, which is local `useState` and lands with the act.
    await waitFor(() => expect(view.result.current.isPending).toBe(false));
  });
});
