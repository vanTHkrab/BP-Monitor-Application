/**
 * Passkey list and the three things that change it.
 *
 * Every mutation invalidates the overview too: the hub shows a passkey count,
 * and a count that disagrees with the list one screen away is the kind of
 * inconsistency that makes people distrust a security screen.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as securityApi from '../services/security-api';
import type { Passkey } from '../types';

const PASSKEYS_KEY = ['passkeys'];
const OVERVIEW_KEY = ['security-overview'];

export function usePasskeys() {
  const query = useQuery<Passkey[]>({
    queryKey: PASSKEYS_KEY,
    queryFn: securityApi.fetchPasskeys,
  });

  return {
    passkeys: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useRegisterPasskey() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (name?: string) => securityApi.registerPasskey(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
      void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
  });

  return {
    registerPasskey: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export function useRenamePasskey() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      securityApi.renamePasskey(id, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
    },
  });

  return { renamePasskey: mutation.mutateAsync, isPending: mutation.isPending };
}

export function useDeletePasskey() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => securityApi.deletePasskey(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
      void queryClient.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
  });

  return {
    deletePasskey: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
