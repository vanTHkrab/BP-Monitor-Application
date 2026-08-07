/**
 * Setting the phone number after a Google sign-up.
 *
 * This runs on a blocking screen: the account exists but is unusable until
 * `phone` is set, because it is `NOT NULL` and unique and caregivers find
 * patients by it. Two consequences the tests below pin down.
 *
 * The cache write is not a nicety — it is the exit condition. Nothing
 * refetches `me` here, so if `onSuccess` wrote a partial object or wrote under
 * the wrong key, `useSession().user.phone` stays empty and the user is held on
 * the same screen after a request that succeeded.
 *
 * And the duplicate-phone case has to stay distinguishable. `updateProfile`
 * returns `CONFLICT` for a number another account already owns; the login
 * context maps that to a generic "ข้อมูลซ้ำ" with no field, which is the
 * behaviour recorded here rather than endorsed — see the finding in the
 * report.
 */
const mockUpdateProfile = jest.fn();
jest.mock('../services/auth-api', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';

import type { User } from '../types';
import { USER } from './__fixtures__/session';
import { useSetPhone } from './use-set-phone';

const NEW_PHONE = '0898765432';
const UPDATED: User = { ...USER, phone: NEW_PHONE };

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderSetPhone = () => renderHook(() => useSetPhone(), { wrapper });

async function submit(
  view: Awaited<ReturnType<typeof renderSetPhone>>,
  phone = NEW_PHONE,
): Promise<unknown> {
  let thrown: unknown = null;
  await act(async () => {
    try {
      await view.result.current.setPhone(phone);
    } catch (error) {
      thrown = error;
    }
  });
  return thrown;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateProfile.mockReset();
  mockUpdateProfile.mockResolvedValue(UPDATED);

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('the request', () => {
  it('sends only the phone field', async () => {
    const view = await renderSetPhone();
    await submit(view);

    // `toEqual` on the whole input: `updateProfile` overwrites what it is
    // given, so an extra key here silently rewrites a field of the profile
    // this screen has no business touching.
    expect(mockUpdateProfile).toHaveBeenCalledWith({ phone: NEW_PHONE });
  });
});

describe('the cached user afterwards', () => {
  it('is the whole user the gateway returned, under the key `useSession` reads', async () => {
    client.setQueryData(['me'], USER);

    const view = await renderSetPhone();
    await submit(view);

    // The exit condition for the blocking screen. The server response is
    // used verbatim rather than patched locally, so a field the gateway
    // normalised (a phone stored without its leading zero, say) is what the
    // rest of the app sees.
    expect(client.getQueryData<User>(['me'])).toEqual(UPDATED);
  });

  it('populates `me` even when nothing had cached it yet', async () => {
    const view = await renderSetPhone();
    await submit(view);

    expect(client.getQueryData<User>(['me'])).toEqual(UPDATED);
  });

  it('leaves the previous user in place when the write fails', async () => {
    client.setQueryData(['me'], USER);
    mockUpdateProfile.mockRejectedValue(new ApiError('taken', { code: 'CONFLICT' }));

    const view = await renderSetPhone();
    await submit(view);

    // Writing an optimistic phone here would release the blocking screen for
    // a number the account does not have.
    expect(client.getQueryData<User>(['me'])).toEqual(USER);
    expect(client.getQueryData<User>(['me'])?.phone).toBe(USER.phone);
  });
});

describe('what the caller is told when it fails', () => {
  it('rejects with the transport error, code intact', async () => {
    const cause = new ApiError('[CONFLICT] taken', { code: 'CONFLICT', httpStatus: 409 });
    mockUpdateProfile.mockRejectedValue(cause);

    const view = await renderSetPhone();

    expect(await submit(view)).toBe(cause);
  });

  it('shows the gateway own Thai validation message, minus the log prefix', async () => {
    mockUpdateProfile.mockRejectedValue(
      new ApiError('[BAD_USER_INPUT] เบอร์โทรศัพท์ไม่ถูกต้อง', { code: 'BAD_USER_INPUT' }),
    );

    const view = await renderSetPhone();
    await submit(view);

    // `PHONE_REGEX` lives on the gateway, so its message is the only thing
    // that can tell the user *why* the number was refused.
    expect(view.result.current.error).toEqual({
      message: 'เบอร์โทรศัพท์ไม่ถูกต้อง',
      field: null,
      retryAfterSec: null,
    });
  });

  it('replaces a raw English validation message rather than showing it', async () => {
    mockUpdateProfile.mockRejectedValue(
      new ApiError('[BAD_USER_INPUT] phone must match /^0[0-9]{9}$/', { code: 'BAD_USER_INPUT' }),
    );

    const view = await renderSetPhone();
    await submit(view);

    expect(view.result.current.error?.message).toBe('ข้อมูลที่กรอกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
  });

  it('reports a number belonging to another account, with no field attached', async () => {
    mockUpdateProfile.mockRejectedValue(
      new ApiError('[CONFLICT] เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว', { code: 'CONFLICT' }),
    );

    const view = await renderSetPhone();
    await submit(view);

    // Recording current behaviour, not endorsing it: this hook passes no
    // `context`, so the formatter takes its non-register branch and the one
    // input on the screen is not highlighted. See the report.
    expect(view.result.current.error).toEqual({
      message: 'ข้อมูลซ้ำกับที่มีอยู่แล้วในระบบ',
      field: null,
      retryAfterSec: null,
    });
  });

  it('falls back to Thai copy for an English transport failure', async () => {
    mockUpdateProfile.mockRejectedValue(new Error('Network request failed'));

    const view = await renderSetPhone();
    await submit(view);

    expect(view.result.current.error?.message).toBe('บันทึกเบอร์โทรศัพท์ไม่สำเร็จ กรุณาลองใหม่');
  });

  it('clears the banner on dismiss and on the next attempt', async () => {
    mockUpdateProfile.mockRejectedValueOnce(new Error('boom'));

    const view = await renderSetPhone();
    await submit(view);
    expect(view.result.current.error).not.toBeNull();

    await act(async () => {
      view.result.current.clearError();
    });
    expect(view.result.current.error).toBeNull();

    mockUpdateProfile.mockRejectedValueOnce(new Error('boom'));
    await submit(view);
    expect(view.result.current.error).not.toBeNull();
    await submit(view);
    expect(view.result.current.error).toBeNull();
    expect(view.result.current.isPending).toBe(false);
  });
});
