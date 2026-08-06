import { useQuery } from '@tanstack/react-query';

import * as securityApi from '../services/security-api';
import type { SecurityOverview } from '../types';

/**
 * The security hub's single read.
 *
 * One query rather than three (`me` + sessions + passkeys) because the screen
 * answers one question — "is my account safe?" — and a half-loaded answer to
 * that reads as an alarming one.
 */
export function useSecurityOverview() {
  const query = useQuery<SecurityOverview>({
    queryKey: ['security-overview'],
    queryFn: securityApi.fetchSecurityOverview,
  });

  return {
    overview: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
