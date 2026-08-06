/**
 * Sets the phone number after a Google sign-up.
 *
 * A Google sign-up carries no phone, and `phone` is `NOT NULL` and unique —
 * caregivers find patients by it — so this is a mandatory step before the
 * account is usable, not a settings-screen edit. Reuses `updateProfile`
 * rather than a dedicated mutation: the gateway already validates `phone`
 * there (`PHONE_REGEX`), and a second endpoint would just duplicate it.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import * as authApi from '../services/auth-api';
import { formatAuthError } from '../lib/errors';
import type { AuthErrorView, User } from '../types';

export function useSetPhone() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<AuthErrorView | null>(null);

  const mutation = useMutation({
    mutationFn: (phone: string) => authApi.updateProfile({ phone }),
    onMutate: () => setError(null),
    onSuccess: (user: User) => {
      queryClient.setQueryData(['me'], user);
    },
    onError: (cause) =>
      setError(
        formatAuthError(cause, { fallback: 'บันทึกเบอร์โทรศัพท์ไม่สำเร็จ กรุณาลองใหม่' }),
      ),
  });

  return {
    setPhone: mutation.mutateAsync,
    isPending: mutation.isPending,
    error,
    clearError: () => setError(null),
  };
}
