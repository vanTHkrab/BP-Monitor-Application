/**
 * The devices signed into this account.
 *
 * Cached here rather than mirrored in SQLite: the whole value of this screen
 * is that it reflects the server *now*. A stale local copy showing a device
 * the user already revoked would be worse than an empty list — see the cache
 * boundary note in `services/query-client.ts`.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import * as authApi from '../services/auth-api';
import type { LoginSession } from '../types';

// Deep import for the cycle reason written in `use-logout.ts`.
import { getRegisteredPushToken } from '@/modules/notifications/services/push-registration';

export function useLoginSessions() {
  const query = useQuery<LoginSession[]>({
    queryKey: ['login-sessions'],
    queryFn: authApi.fetchLoginSessions,
  });

  return {
    sessions: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Signs every *other* device out. This one keeps its session — a "log out
 * everywhere" that also logs you out of the phone in your hand reads as the
 * app crashing rather than as the security action it is.
 *
 * The push token is passed for the same reason, one layer down: the gateway
 * reads it as `keepPushToken` and drops every *other* installation's, so
 * without it this phone would be unsubscribed alongside the devices it just
 * revoked — still signed in, silently no longer notified. Note the inversion
 * against `logout`, where the identically-named argument means "delete this
 * one".
 */
export function useLogoutAllDevices() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const pushToken = (await getRegisteredPushToken()) ?? undefined;
      await authApi.logoutAllDevices(pushToken);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['login-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['security-overview'] });
    },
  });

  return {
    logoutAllDevices: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
}
