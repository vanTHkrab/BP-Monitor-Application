/**
 * Registration as a mutation. Same shape as `useLogin` — the gateway returns
 * the same `AuthPayload`, so a successful sign-up lands signed in.
 *
 * The optional avatar is uploaded *after* the account exists, not as part of
 * `RegisterInput`. Two reasons: the presign mutations need a session, and a
 * failed photo upload must never look like a failed registration. The account
 * is real either way; the photo can be added later from the profile screen.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { setAuthToken } from '@/services/auth-token';
import { uploadImageViaPresign } from '@/services/upload-image';
import { useAuthStore } from '@/stores';
import { formatAuthError } from '../lib/errors';
import * as authApi from '../services/auth-api';
import type { AuthErrorView, RegisterInput, User } from '../types';

export type RegisterVariables = RegisterInput & {
  /** Local URI from the picker. Uploaded after the account is created. */
  avatarUri?: string | null;
};

/**
 * Best-effort: returns the user unchanged when there is no photo, or when
 * anything in the upload path fails. Never throws — see the note above.
 */
async function attachAvatar(user: User, avatarUri?: string | null): Promise<User> {
  if (!avatarUri) return user;
  try {
    const uploaded = await uploadImageViaPresign({ uri: avatarUri, kind: 'PROFILE' });
    return await authApi.updateProfile({ avatar: uploaded.url });
  } catch {
    return user;
  }
}

export function useRegister() {
  const signedIn = useAuthStore((state) => state.signedIn);
  const queryClient = useQueryClient();
  const [error, setError] = useState<AuthErrorView | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ avatarUri, ...input }: RegisterVariables) => {
      const result = await authApi.register(input);

      // The token has to be stored before the upload: `graphqlRequest` reads
      // it to build the Authorization header, and the presign mutations are
      // authenticated.
      await setAuthToken(result.token);

      const user = await attachAvatar(result.user, avatarUri);
      return { token: result.token, user };
    },
    onMutate: () => setError(null),
    onSuccess: ({ token, user }) => {
      // Cache before store: see the note in use-login.ts's onSuccess — a
      // synchronous re-render on `signedIn` must never be able to observe a
      // previous account's `roleSelectedAt` still sitting in the `me` cache.
      queryClient.clear();
      queryClient.setQueryData(['me'], user);

      signedIn({ userId: user.id, token });
    },
    onError: (cause) =>
      setError(
        formatAuthError(cause, {
          context: 'register',
          fallback: 'ไม่สามารถลงทะเบียนได้ กรุณาตรวจสอบข้อมูลและลองใหม่',
        }),
      ),
  });

  return {
    register: mutation.mutateAsync,
    isPending: mutation.isPending,
    error,
    clearError: () => setError(null),
  };
}
