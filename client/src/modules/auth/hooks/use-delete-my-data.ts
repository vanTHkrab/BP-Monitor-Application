/**
 * Deletes the account's readings, posts, and likes on the server.
 *
 * Not account deletion — the account, profile, and caregiver links survive.
 * The wording in the UI has to match that exactly, because "ลบข้อมูลทั้งหมด"
 * next to a sign-out button reads like account closure to most people, and
 * this is not reversible either way.
 *
 * The whole query cache is cleared rather than selectively invalidated: after
 * this call, every cached list of readings or posts is describing rows that no
 * longer exist, and enumerating them here means a future feature's cache is
 * the one that gets missed.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as authApi from '../services/auth-api';

export function useDeleteMyData() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: authApi.deleteMyData,
    onSuccess: () => {
      queryClient.clear();
    },
  });

  return {
    deleteMyData: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
