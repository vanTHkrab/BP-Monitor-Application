/**
 * TanStack Query, scoped to network-only data.
 *
 * The boundary this file exists to enforce:
 *
 *   - Data with a SQLite mirror (readings, posts) is NOT cached here. Those
 *     screens read the local database through `useLiveQuery`, which is
 *     already reactive and — unlike an in-memory query cache — survives the
 *     app being killed. Putting them here too would mean two caches for one
 *     entity, updated at different times.
 *   - Data with no local mirror (profile, caregivers, chat) belongs here.
 *     There is nothing else to be stale against, and this is where the
 *     dedupe / retry / refetch-on-focus behaviour is worth having.
 *
 * If a domain gains a SQLite mirror, it should leave this cache in the same
 * change.
 */
import { QueryClient } from '@tanstack/react-query';

import { errorHttpStatus, isNetworkError } from './api-error';

const MAX_NETWORK_RETRIES = 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Screens re-focus constantly on mobile; without this every tab
        // switch would refetch data that is seconds old.
        staleTime: 30_000,
        retry: (failureCount, error) => {
          // Only retry failures that could plausibly succeed later. A
          // FORBIDDEN or BAD_USER_INPUT will fail identically every time,
          // and retrying a 429 makes the throttle worse.
          if (!isNetworkError(error)) return false;
          return failureCount < MAX_NETWORK_RETRIES;
        },
      },
      mutations: {
        // Mutations are not idempotent here — a retried createReading can
        // produce a duplicate. Durable retry belongs to the SQLite queue,
        // which dedupes on clientId, not to this cache.
        retry: false,
      },
    },
  });
}

/** True when the failure is the gateway's login throttle. */
export const isThrottled = (error: unknown): boolean => errorHttpStatus(error) === 429;
