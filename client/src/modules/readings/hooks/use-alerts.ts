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
import { useSubject } from '@/modules/caregivers';

import * as alertsApi from '../services/alerts-api';
import type { Alert } from '../types';

/**
 * Keyed by subject, not a bare `['alerts']`.
 *
 * A single key would serve the caregiver's own alerts from cache the moment
 * they entered a patient, and then overwrite them with the patient's — the
 * badge would show whichever request landed last. Two subjects are two
 * cache entries.
 */
const alertsKey = (subjectId: string) => ['alerts', subjectId];

export function useAlerts() {
  const { isAuthenticated } = useSession();
  // Read rather than accepted as a prop: see `modules/caregivers/hooks/
  // use-subject.ts` for why this is not a parameter.
  const { subjectId, isSelf, patientIdArg } = useSubject();

  const query = useQuery<Alert[]>({
    queryKey: alertsKey(subjectId),
    queryFn: () => alertsApi.fetchAlerts(patientIdArg),
    enabled: isAuthenticated && Boolean(subjectId),
  });

  const alerts = query.data ?? [];

  return {
    alerts,
    unreadCount: alerts.filter((alert) => !alert.isRead).length,
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
    /**
     * False while a caregiver is viewing a patient.
     *
     * `markRead` on the gateway is scoped to the alert's **owner**
     * (`where: { id, userId }`), so a caregiver's attempt matches no rows and
     * returns false — a silent no-op the UI would render as success. That
     * scoping is right: marking read is the patient's own state, and letting
     * a caregiver clear it would hide a critical alert from the person it is
     * about. So the screen hides the controls instead of offering something
     * that does nothing.
     *
     * A caregiver getting alerts *of their own* about a patient is the real
     * answer here, and needs the fan-out in docs/todo/CLIENT-caregiver.md §3.
     */
    canMarkRead: isSelf,
  };
}

export function useMarkAlertRead() {
  const queryClient = useQueryClient();
  // Same key the query wrote under. A bare ['alerts'] would roll back onto,
  // and optimistically patch, whichever subject was cached last.
  const { subjectId } = useSubject();
  const key = alertsKey(subjectId);

  const mutation = useMutation({
    mutationFn: (id: number) => alertsApi.markAlertRead(id),

    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Alert[]>(key);

      queryClient.setQueryData<Alert[]>(key, (alerts) =>
        alerts?.map((alert) => (alert.id === id ? { ...alert, isRead: true } : alert)),
      );

      return { previous };
    },

    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });

  return { markAlertRead: mutation.mutate };
}

export function useMarkAllAlertsRead() {
  const queryClient = useQueryClient();
  const { subjectId } = useSubject();
  const key = alertsKey(subjectId);

  const mutation = useMutation({
    mutationFn: () => alertsApi.markAllAlertsRead(),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Alert[]>(key);

      queryClient.setQueryData<Alert[]>(key, (alerts) =>
        alerts?.map((alert) => ({ ...alert, isRead: true })),
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });

  return { markAllAlertsRead: mutation.mutate, isPending: mutation.isPending };
}
