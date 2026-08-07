/**
 * Registration, and the promise its docstring makes: "a failed photo upload
 * must never look like a failed registration".
 *
 * That is a *negative* property and the happy path cannot see it. The account
 * is real the moment `register` resolves; everything after — the presign, the
 * S3 PUT, the `updateProfile` — is decoration. So most of this file breaks the
 * avatar path on purpose and asserts the caller still ends up signed in, with
 * a token, with `me` populated, and with no error banner.
 *
 * The ordering assertion is the other one worth having: the token has to be
 * stored *before* the upload starts, because `graphqlRequest` reads it to
 * build the Authorization header and the presign mutations are authenticated.
 * Swap those two lines and registration-with-a-photo silently loses the photo
 * for every user, while every end-state assertion stays green.
 */
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

/** Records the token-write / upload / store-flip interleaving. */
const calls: string[] = [];

const mockRegister = jest.fn();
const mockUpdateProfile = jest.fn();
jest.mock('../services/auth-api', () => ({
  register: (...args: unknown[]) => mockRegister(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

const mockSetAuthToken = jest.fn(async () => {
  calls.push('token');
});
jest.mock('@/services/auth-token', () => ({
  setAuthToken: (...args: unknown[]) => mockSetAuthToken(...(args as [])),
}));

const mockUploadImageViaPresign = jest.fn();
jest.mock('@/services/upload-image', () => ({
  uploadImageViaPresign: (...args: unknown[]) => mockUploadImageViaPresign(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';

import { ApiError } from '@/services/api-error';
import { resetAuthStore, useAuthStore } from '@/stores';

import { observeSignIn, OTHER_USER, USER } from './__fixtures__/session';
import { useRegister, type RegisterVariables } from './use-register';

const INPUT: RegisterVariables = {
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  password: 'hunter2',
  email: 'somchai@example.com',
};

const WITH_AVATAR: RegisterVariables = { ...INPUT, avatarUri: 'file:///tmp/selfie.jpg' };

const USER_WITH_AVATAR = { ...USER, avatar: 'https://cdn.example.com/u1.jpg' };

let client: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const renderRegister = () => renderHook(() => useRegister(), { wrapper });

async function submit(
  view: Awaited<ReturnType<typeof renderRegister>>,
  input: RegisterVariables = INPUT,
): Promise<{ result?: unknown; thrown?: unknown }> {
  const outcome: { result?: unknown; thrown?: unknown } = {};
  await act(async () => {
    try {
      outcome.result = await view.result.current.register(input);
    } catch (error) {
      outcome.thrown = error;
    }
  });
  return outcome;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRegister.mockReset();
  mockUpdateProfile.mockReset();
  mockUploadImageViaPresign.mockReset();

  mockRegister.mockImplementation(async () => {
    calls.push('register');
    return { token: 'tok-1', user: USER };
  });
  mockUploadImageViaPresign.mockImplementation(async () => {
    calls.push('upload');
    return { url: 'https://cdn.example.com/u1.jpg' };
  });
  mockUpdateProfile.mockImplementation(async () => {
    calls.push('updateProfile');
    return USER_WITH_AVATAR;
  });
  calls.length = 0;

  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  resetAuthStore();
});

afterEach(() => {
  client.cancelQueries();
  client.clear();
});

describe('the payload that reaches the gateway', () => {
  it('sends the registration fields and nothing the schema would reject', async () => {
    const view = await renderRegister();
    await submit(view, WITH_AVATAR);

    // `toEqual` on the whole object, not `objectContaining`: `avatarUri` is a
    // local file path that `RegisterInput` has no field for, and GraphQL
    // rejects an unknown input field for the *whole* operation — the account
    // would simply never be created.
    expect(mockRegister).toHaveBeenCalledWith({
      firstname: 'สมชาย',
      lastname: 'ใจดี',
      phone: '0812345678',
      password: 'hunter2',
      email: 'somchai@example.com',
    });
    expect(mockRegister.mock.calls[0][0]).not.toHaveProperty('avatarUri');
  });

  it('does not reach the upload path at all without a photo', async () => {
    const view = await renderRegister();
    await submit(view, { ...INPUT, avatarUri: null });

    expect(mockUploadImageViaPresign).not.toHaveBeenCalled();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('uploads the picked file as a profile image', async () => {
    const view = await renderRegister();
    await submit(view, WITH_AVATAR);

    expect(mockUploadImageViaPresign).toHaveBeenCalledWith({
      uri: 'file:///tmp/selfie.jpg',
      kind: 'PROFILE',
    });
    expect(mockUpdateProfile).toHaveBeenCalledWith({ avatar: 'https://cdn.example.com/u1.jpg' });
  });
});

describe('ordering', () => {
  it('stores the token before the authenticated presign call goes out', async () => {
    const view = await renderRegister();
    await submit(view, WITH_AVATAR);

    // Reversed, `graphqlRequest` builds the presign request with no
    // Authorization header, every avatar upload 401s, and the failure is
    // swallowed by `attachAvatar` — nobody ever gets a profile photo at
    // sign-up and nothing anywhere reports it.
    expect(calls).toEqual(['register', 'token', 'upload', 'updateProfile']);
  });

  it('has the new user in the `me` cache at the instant `status` flips', async () => {
    client.setQueryData(['me'], OTHER_USER);
    client.setQueryData(['security-overview'], { passkeyCount: 3 });
    const { observation, stop } = observeSignIn(client);

    const view = await renderRegister();
    await submit(view, WITH_AVATAR);
    stop();

    expect(observation.flipped).toBe(true);
    // The uploaded avatar, not the pre-upload user: the profile screen renders
    // straight off this cache entry.
    expect(observation.meAtFlip).toEqual(USER_WITH_AVATAR);
    expect(observation.strayKeysAtFlip).toBe(0);
  });
});

describe('the account is real even when the photo is not', () => {
  it('signs the user in when the presign fails', async () => {
    mockUploadImageViaPresign.mockRejectedValue(
      new ApiError('[BAD_USER_INPUT] ไฟล์ใหญ่เกินไป', { code: 'BAD_USER_INPUT' }),
    );

    const view = await renderRegister();
    const { result, thrown } = await submit(view, WITH_AVATAR);

    expect(thrown).toBeUndefined();
    expect(result).toEqual({ token: 'tok-1', user: USER });
    expect(view.result.current.error).toBeNull();
    expect(useAuthStore.getState()).toMatchObject({ status: 'authenticated', userId: USER.id });
  });

  it('signs the user in when the profile update fails after a good upload', async () => {
    mockUpdateProfile.mockRejectedValue(new Error('Network request failed'));

    const view = await renderRegister();
    const { result, thrown } = await submit(view, WITH_AVATAR);

    expect(thrown).toBeUndefined();
    // The pre-upload user — the account exists, it just has no photo yet.
    expect(result).toEqual({ token: 'tok-1', user: USER });
    expect(client.getQueryData(['me'])).toEqual(USER);
    expect(view.result.current.error).toBeNull();
  });

  it('keeps the token from the register call when the photo path collapses', async () => {
    mockUploadImageViaPresign.mockRejectedValue(new Error('boom'));

    const view = await renderRegister();
    await submit(view, WITH_AVATAR);

    // Not writing it here would leave an account that exists on the server
    // and a phone with no credential for it — the user is bounced to login
    // for an account whose password they just chose.
    expect(mockSetAuthToken).toHaveBeenCalledWith('tok-1');
    expect(useAuthStore.getState().token).toBe('tok-1');
  });
});

describe('what the caller receives when registration itself fails', () => {
  it('rejects with the transport error, code intact', async () => {
    const cause = new ApiError('[CONFLICT] เบอร์ซ้ำ', { code: 'CONFLICT', httpStatus: 409 });
    mockRegister.mockRejectedValue(cause);

    const view = await renderRegister();
    const { thrown } = await submit(view);

    expect(thrown).toBe(cause);
    expect(thrown).toMatchObject({ code: 'CONFLICT', httpStatus: 409 });
  });

  it('attaches a duplicate phone to the phone field', async () => {
    mockRegister.mockRejectedValue(
      new ApiError('[CONFLICT] เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว', { code: 'CONFLICT' }),
    );

    const view = await renderRegister();
    await submit(view);

    // The `register` context is what makes this land on a field at all; the
    // login-context branch returns `field: null` and the form would show the
    // message with nothing highlighted.
    expect(view.result.current.error).toEqual({
      message: 'เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว',
      field: 'phone',
      retryAfterSec: null,
    });
  });

  it('attaches a duplicate email to the email field', async () => {
    mockRegister.mockRejectedValue(
      new ApiError('[CONFLICT] อีเมลนี้ถูกใช้งานแล้ว', { code: 'CONFLICT' }),
    );

    const view = await renderRegister();
    await submit(view);

    expect(view.result.current.error).toEqual({
      message: 'อีเมลนี้ถูกใช้งานแล้ว',
      field: 'email',
      retryAfterSec: null,
    });
  });

  it('shows the gateway validation message when it is already Thai', async () => {
    mockRegister.mockRejectedValue(
      new ApiError('[BAD_USER_INPUT] รหัสผ่านสั้นเกินไป', { code: 'BAD_USER_INPUT' }),
    );

    const view = await renderRegister();
    await submit(view);

    // Minus the `[CODE] ` prefix the transport prepends for logging.
    expect(view.result.current.error?.message).toBe('รหัสผ่านสั้นเกินไป');
  });

  it('leaves nothing behind — no token, no session, no cache write', async () => {
    mockRegister.mockRejectedValue(new ApiError('nope', { code: 'BAD_USER_INPUT' }));
    client.setQueryData(['me'], OTHER_USER);

    const view = await renderRegister();
    await submit(view, WITH_AVATAR);

    expect(mockSetAuthToken).not.toHaveBeenCalled();
    expect(mockUploadImageViaPresign).not.toHaveBeenCalled();
    expect(useAuthStore.getState().status).not.toBe('authenticated');
    expect(client.getQueryData(['me'])).toEqual(OTHER_USER);
  });

  it('clears the banner on dismiss and on the next attempt', async () => {
    mockRegister.mockRejectedValueOnce(new Error('boom'));

    const view = await renderRegister();
    await submit(view);
    expect(view.result.current.error?.message).toBe(
      'ไม่สามารถลงทะเบียนได้ กรุณาตรวจสอบข้อมูลและลองใหม่',
    );

    await act(async () => {
      view.result.current.clearError();
    });
    expect(view.result.current.error).toBeNull();
  });
});
