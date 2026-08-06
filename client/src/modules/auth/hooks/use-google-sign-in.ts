/**
 * Google sign-in from the on-device account picker — "One Tap" on Android.
 *
 * Deliberately *not* Better Auth's `oneTap` plugin: that one drives Google
 * Identity Services in a browser and expects a cookie back. On Android the
 * picker is Credential Manager, which returns an ID token to the app directly.
 * So the token is collected here and exchanged at the gateway, which verifies
 * Google's signature and audience before it means anything — the client never
 * decides who the user is.
 *
 * Configuration is env-gated on purpose. Without `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
 * the button is hidden rather than shown and broken: a Google button that fails
 * on tap reads as "this app is broken", not "this build has no credentials".
 */
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { setAuthToken } from '@/services/auth-token';
import { useAuthStore } from '@/stores';
import { formatAuthError } from '../lib/errors';
import { writeLastLoginMethod } from '../lib/last-login-method';
import * as authApi from '../services/auth-api';
import type { AuthErrorView } from '../types';

/**
 * The *web* client ID, even on Android. This is the one counter-intuitive part
 * of the setup: Credential Manager mints an ID token whose audience is the web
 * client, and the Android client ID is only there to tie the request to this
 * app's signing certificate. Passing the Android ID here yields a token the
 * gateway rejects.
 */
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim();

export function isGoogleSignInConfigured(): boolean {
  return Boolean(WEB_CLIENT_ID);
}

let configured = false;

function configureOnce(): void {
  if (configured || !WEB_CLIENT_ID) return;
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
  configured = true;
}

export function useGoogleSignIn() {
  const signedIn = useAuthStore((state) => state.signedIn);
  const queryClient = useQueryClient();
  const [error, setError] = useState<AuthErrorView | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      configureOnce();
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken;

      if (!idToken) {
        // `signIn` resolves with `type: 'cancelled'` when the sheet is
        // dismissed, which lands here with no token. Distinguished below so
        // it never becomes a red banner.
        throw new GoogleCancelled();
      }

      return authApi.loginWithGoogle(idToken);
    },
    onMutate: () => setError(null),
    onSuccess: async ({ token, user }) => {
      // Same ordering as `useLogin`, for the same reason — see the comment
      // there about the window between the token write and the store flip.
      await setAuthToken(token);
      queryClient.clear();
      queryClient.setQueryData(['me'], user);
      signedIn({ userId: user.id, token });
      void writeLastLoginMethod('google');
    },
    onError: (cause) => {
      if (isCancellation(cause)) return;

      setError(
        formatAuthError(cause, {
          context: 'login',
          fallback: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่',
        }),
      );
    },
  });

  return {
    signInWithGoogle: mutation.mutateAsync,
    isPending: mutation.isPending,
    error,
    clearError: () => setError(null),
  };
}

class GoogleCancelled extends Error {
  constructor() {
    super('google-sign-in-cancelled');
  }
}

function isCancellation(cause: unknown): boolean {
  if (cause instanceof GoogleCancelled) return true;
  const code = (cause as { code?: unknown })?.code;
  return code === statusCodes.SIGN_IN_CANCELLED;
}
