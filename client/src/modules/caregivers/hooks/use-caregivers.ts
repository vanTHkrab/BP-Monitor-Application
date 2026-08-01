/**
 * The invitations screen's reads and the three things that change them.
 *
 * Every mutation invalidates both keys. The two lists describe the same
 * relationships from different angles — accepting an invite moves a row out
 * of "รอตอบรับ" and into the caregiver's patient list — so refreshing one
 * without the other leaves the screen showing a state that no longer exists.
 *
 * There is no offline queue here on purpose. Accepting an invite is an
 * authorization decision: queueing one locally would show the patient
 * "อนุญาตแล้ว" while the caregiver still has no access, and a queue that
 * replays it later could grant access the patient has since thought better
 * of. Readings queue offline; consent does not.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useSession } from '@/modules/auth';

import * as caregiversApi from '../services/caregivers-api';
import type { CaregiverLink, InvitePatientInput, PatientSummary } from '../types';

const LINKS_KEY = ['caregiver-links'];
const PATIENTS_KEY = ['my-patients'];

/** Both lists, so a mutation cannot leave half the screen stale. */
function useInvalidateCaregivers() {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({ queryKey: LINKS_KEY });
    void queryClient.invalidateQueries({ queryKey: PATIENTS_KEY });
  };
}

/**
 * Every link touching this account, in both directions. The screen derives
 * its sections from `status` and from which side of the row the user is on —
 * see `use-caregiver-sections.ts`.
 */
export function useCaregiverLinks() {
  const { isAuthenticated } = useSession();

  const query = useQuery<CaregiverLink[]>({
    queryKey: LINKS_KEY,
    queryFn: caregiversApi.fetchCaregiverLinks,
    enabled: isAuthenticated,
  });

  return {
    links: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Accepted patients, with the `id` and `avatar` the symmetric link row lacks.
 *
 * Disabled for patients rather than merely unused: the gateway would answer
 * with an empty list, but paying for a round trip to learn that on every
 * focus is a cost with no reader.
 */
export function useMyPatients({ enabled = true }: { enabled?: boolean } = {}) {
  const { isAuthenticated } = useSession();

  const query = useQuery<PatientSummary[]>({
    queryKey: PATIENTS_KEY,
    queryFn: caregiversApi.fetchMyPatients,
    enabled: isAuthenticated && enabled,
  });

  return {
    patients: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useInvitePatient() {
  const invalidate = useInvalidateCaregivers();

  const mutation = useMutation({
    mutationFn: (input: InvitePatientInput) => caregiversApi.invitePatient(input),
    onSuccess: invalidate,
  });

  return {
    invitePatient: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export function useRespondToInvite() {
  const invalidate = useInvalidateCaregivers();

  const mutation = useMutation({
    mutationFn: ({ caregiverId, accept }: { caregiverId: string; accept: boolean }) =>
      caregiversApi.respondToInvite(caregiverId, accept),
    onSuccess: invalidate,
  });

  return {
    respondToInvite: mutation.mutateAsync,
    isPending: mutation.isPending,
    /** The invite currently being answered, so one row can spin alone. */
    pendingCaregiverId: mutation.isPending ? (mutation.variables?.caregiverId ?? null) : null,
    error: mutation.error,
  };
}

export function useRemoveCaregiverLink() {
  const invalidate = useInvalidateCaregivers();

  const mutation = useMutation({
    mutationFn: ({ caregiverId, patientId }: { caregiverId: string; patientId: string }) =>
      caregiversApi.removeCaregiverLink(caregiverId, patientId),
    onSuccess: invalidate,
  });

  return {
    removeCaregiverLink: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
