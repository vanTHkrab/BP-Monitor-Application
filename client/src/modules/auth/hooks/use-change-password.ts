/**
 * Changing the password from the security screen.
 *
 * No optimistic update and no local state to reconcile: the only visible
 * effect is that other devices stop working, which this device cannot show
 * anyway. The session list is invalidated because the gateway revokes every
 * other session as part of the same call — leaving the old list on screen
 * would tell the user their other phone is still signed in when it is not.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as authApi from '../services/auth-api';

export function useChangePassword() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['login-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['security-overview'] });
    },
  });

  return {
    changePassword: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
