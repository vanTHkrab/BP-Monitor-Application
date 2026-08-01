/**
 * Server-raised alerts, and the two things that change them.
 *
 * TanStack Query, not SQLite — alerts have no local mirror, so this cache is
 * the only copy and there is nothing for it to be stale against. That is the
 * same boundary `services/query-client.ts` draws; readings sit on the other
 * side of it because they do have a mirror.
 *
 * Marking read is optimistic. The bell's badge is the only thing that
 * changes, the user just tapped the row, and a count that waits a round trip
 * to decrement reads as a tap that did not register.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/modules/auth';

import * as alertsApi from '../services/alerts-api';
import type { Alert } from '../types';

const ALERTS_KEY = ['alerts'];

export function useAlerts() {
  const { isAuthenticated } = useSession();

  const query = useQuery<Alert[]>({
    queryKey: ALERTS_KEY,
    queryFn: alertsApi.fetchAlerts,
    enabled: isAuthenticated,
  });

  const alerts = query.data ?? [];

  return {
    alerts,
    unreadCount: alerts.filter((alert) => !alert.isRead).length,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: number) => alertsApi.markAlertRead(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ALERTS_KEY });
      const previous = queryClient.getQueryData<Alert[]>(ALERTS_KEY);

      queryClient.setQueryData<Alert[]>(ALERTS_KEY, (alerts) =>
        alerts?.map((alert) => (alert.id === id ? { ...alert, isRead: true } : alert)),
      );

      return { previous };
    },

    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(ALERTS_KEY, context.previous);
    },
  });

  return { markAlertRead: mutation.mutate };
}

export function useMarkAllAlertsRead() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => alertsApi.markAllAlertsRead(),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ALERTS_KEY });
      const previous = queryClient.getQueryData<Alert[]>(ALERTS_KEY);

      queryClient.setQueryData<Alert[]>(ALERTS_KEY, (alerts) =>
        alerts?.map((alert) => ({ ...alert, isRead: true })),
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(ALERTS_KEY, context.previous);
    },
  });

  return { markAllAlertsRead: mutation.mutate, isPending: mutation.isPending };
}
