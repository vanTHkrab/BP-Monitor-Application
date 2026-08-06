/**
 * Signing in with a passkey, from the login screen.
 *
 * The session bootstrap is copied from `useLogin` rather than shared, and the
 * ordering matters for the same reason it does there: token first, then clear
 * the previous user's cache, then flip the store. A comment in `use-login.ts`
 * explains the window that closes.
 *
 * It is a hook in this module rather than in `modules/auth` because the whole
 * WebAuthn ceremony — including the native call — lives here, and splitting
 * "sign in" from "the protocol that signs you in" would put half of it in each
 * module.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { formatAuthError, type AuthErrorView } from '@/modules/auth';
import { writeLastLoginMethod } from '@/modules/auth/lib/last-login-method';
import { setAuthToken } from '@/services/auth-token';
import { useAuthStore } from '@/stores';
import * as securityApi from '../services/security-api';

/** True when this device can present a passkey at all — no screen lock, no passkeys. */
export function isPasskeyAvailableOnDevice(): boolean {
  return securityApi.isPasskeySupportedOnDevice();
}

export function usePasskeySignIn() {
  const signedIn = useAuthStore((state) => state.signedIn);
  const queryClient = useQueryClient();
  const [error, setError] = useState<AuthErrorView | null>(null);

  const mutation = useMutation({
    mutationFn: () => securityApi.signInWithPasskey(),
    onMutate: () => setError(null),
    onSuccess: async ({ token, user }) => {
      await setAuthToken(token);
      queryClient.clear();
      queryClient.setQueryData(['me'], user);
      signedIn({ userId: user.id, token });
      void writeLastLoginMethod('passkey');
    },
    onError: (cause) => {
      // A cancelled system sheet is not an error worth shouting about — the
      // user tapped "cancel" and already knows. Anything else gets the normal
      // treatment.
      if (isUserCancellation(cause)) return;

      setError(
        formatAuthError(cause, {
          context: 'login',
          fallback: 'เข้าสู่ระบบด้วย passkey ไม่สำเร็จ กรุณาลองใหม่',
        }),
      );
    },
  });

  return {
    signInWithPasskey: mutation.mutateAsync,
    isPending: mutation.isPending,
    error,
    clearError: () => setError(null),
  };
}

/**
 * react-native-passkey surfaces a cancelled or dismissed system sheet as a
 * thrown error rather than a resolved "no". Matching on the message is
 * unpleasant but it is what the library gives us; a wrong match here only
 * means an extra error banner, never a wrong sign-in.
 */
function isUserCancellation(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  return /cancel|abort|user.?dismiss/i.test(message);
}
