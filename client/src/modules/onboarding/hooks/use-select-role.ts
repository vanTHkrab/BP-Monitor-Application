/**
 * The onboarding role step.
 *
 * Writes straight into the `me` query cache on success so the gate sees
 * `roleSelectedAt` immediately. Without that the screen would navigate on,
 * the gate would re-read a stale cache, and bounce the user back.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { formatAuthError } from '@/modules/auth';
import type { AuthErrorView, User } from '@/modules/auth';
import * as onboardingApi from '../services/onboarding-api';
import type { SelectableRole } from '../types';

export function useSelectRole() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<AuthErrorView | null>(null);

  const mutation = useMutation({
    mutationFn: (role: SelectableRole) => onboardingApi.selectRole(role),
    onMutate: () => setError(null),
    onSuccess: (user: User) => {
      queryClient.setQueryData(['me'], user);
    },
    onError: (cause) =>
      setError(
        formatAuthError(cause, {
          fallback: 'บันทึกบทบาทไม่สำเร็จ กรุณาลองใหม่',
        }),
      ),
  });

  return {
    selectRole: mutation.mutateAsync,
    isPending: mutation.isPending,
    error,
    clearError: () => setError(null),
  };
}
