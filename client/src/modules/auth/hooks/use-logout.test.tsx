/**
 * Sign-out, and the argument that makes it stop the notifications.
 *
 * A gateway `PushToken` row is deliberately not session-scoped — an Expo token
 * belongs to the app installation and has to survive session rotation — so the
 * server cannot work out which installation is leaving. If the client omits
 * the token, `logout` unregisters nothing and the signed-out phone carries on
 * receiving a patient's critical readings. On a shared handset that is a
 * disclosure, and nothing in the happy path shows it.
 */
// `@/stores`' barrel reaches the preferences store, which imports AsyncStorage
// at module scope. Nothing here reads it — this only keeps the native module
// from being null at import time.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock') as unknown,
);

const mockLogout = jest.fn();
jest.mock('../services/auth-api', () => ({
  logout: (...args: unknown[]) => mockLogout(...args),
}));

const mockClearAuthToken = jest.fn();
jest.mock('@/services/auth-token', () => ({
  clearAuthToken: () => mockClearAuthToken(),
}));

const mockGetRegisteredPushToken = jest.fn();
const mockForgetPushToken = jest.fn();
jest.mock('@/modules/notifications/services/push-registration', () => ({
  getRegisteredPushToken: () => mockGetRegisteredPushToken(),
  forgetPushToken: () => mockForgetPushToken(),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { useAuthStore } from '@/stores';

import { useLogout } from './use-logout';

const TOKEN = 'ExponentPushToken[abc123]';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRegisteredPushToken.mockResolvedValue(TOKEN);
  mockLogout.mockResolvedValue(undefined);
  useAuthStore.setState({ status: 'authenticated', userId: 'u1', token: 't' });
});

it('tells the gateway which installation to unregister', async () => {
  const { result } = await renderHook(() => useLogout(), { wrapper });

  await act(() => result.current.logout());

  expect(mockLogout).toHaveBeenCalledWith(TOKEN);
  expect(mockForgetPushToken).toHaveBeenCalled();
  expect(useAuthStore.getState().status).toBe('unauthenticated');
});

/** Expo Go on Android can never obtain one; logout must not depend on it. */
it('still signs out when this device never registered a token', async () => {
  mockGetRegisteredPushToken.mockResolvedValue(null);

  const { result } = await renderHook(() => useLogout(), { wrapper });
  await act(() => result.current.logout());

  expect(mockLogout).toHaveBeenCalledWith(undefined);
  expect(useAuthStore.getState().status).toBe('unauthenticated');
});

/**
 * The user pressed "log out" and that has to be honoured. The token is
 * forgotten anyway: keeping it would hand it to the next account on this
 * handset as theirs to unregister.
 */
it('clears locally and forgets the token even when the revoke fails', async () => {
  mockLogout.mockRejectedValue(new Error('offline'));

  const { result } = await renderHook(() => useLogout(), { wrapper });
  await act(() => result.current.logout());

  expect(mockClearAuthToken).toHaveBeenCalled();
  expect(mockForgetPushToken).toHaveBeenCalled();
  expect(useAuthStore.getState().status).toBe('unauthenticated');
});
