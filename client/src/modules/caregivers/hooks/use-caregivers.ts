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
import type {
  CaregiverLink,
  CaregiverPermission,
  InvitePatientInput,
  PatientSummary,
  ProfileChangeLogEntry,
  UpdatePatientHealthInput,
} from '../types';

const LINKS_KEY = ['caregiver-links'];
const PATIENTS_KEY = ['my-patients'];
/**
 * Deliberately outside `useInvalidateCaregivers`. The trail is the patient's
 * own and a caregiver mutation cannot change it: `updatePatientHealth`
 * appends to the *patient's* log, which the caregiver is never allowed to
 * read. Refreshing it after their write would fetch the actor's unrelated
 * history on every save.
 */
const CHANGE_LOG_KEY = ['profile-change-log'];

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
    mutationFn: ({
      caregiverId,
      accept,
      permission,
    }: {
      caregiverId: string;
      accept: boolean;
      /** Ignored by the gateway when `accept` is false. */
      permission: CaregiverPermission;
    }) => caregiversApi.respondToInvite(caregiverId, accept, permission),
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

/**
 * The patient changes a grant they already made.
 *
 * Separate from `useRespondToInvite` even though both write the same column:
 * that one answers a pending invite and this one edits a settled link, and
 * the gateway refuses each other's rows. Sharing a hook would mean one
 * `pendingCaregiverId` for two different spinners.
 */
export function useUpdateCaregiverPermission() {
  const invalidate = useInvalidateCaregivers();

  const mutation = useMutation({
    mutationFn: ({
      caregiverId,
      permission,
    }: {
      caregiverId: string;
      permission: CaregiverPermission;
    }) => caregiversApi.updateCaregiverPermission(caregiverId, permission),
    onSuccess: invalidate,
  });

  return {
    updatePermission: mutation.mutateAsync,
    isPending: mutation.isPending,
    /** The link currently being changed, so one row can spin alone. */
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

/**
 * A caregiver writes their patient's health information.
 *
 * Invalidates `my-patients` and nothing else. `caregiver-links` describes the
 * *relationship*, which a health edit does not touch — but `myPatients`
 * carries `dob`, `weight` and `height`, so leaving it stale would have the
 * invitations screen and the switcher naming a weight the caregiver has just
 * changed. `useInvalidateCaregivers` would refetch both; that is the right
 * default for a mutation that moves a link between sections and the wrong one
 * here, where the second request answers a question nobody asked.
 *
 * **No offline queue**, for the reason accepting an invite has none, sharpened:
 * this writes to someone else's medical record, and the caregiver's authority
 * to do it can be revoked between the tap and the replay. A queued edit would
 * be applied under a grant the patient had already withdrawn.
 */
export function useUpdatePatientHealth() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      patientId,
      input,
    }: {
      patientId: string;
      input: UpdatePatientHealthInput;
    }) => caregiversApi.updatePatientHealth(patientId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PATIENTS_KEY });
    },
  });

  return {
    updatePatientHealth: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * The patient's own audit trail.
 *
 * Not cached across accounts by anything other than the query key, which is
 * fine because the gateway scopes the answer to the session and sign-out
 * clears the whole client. `limit` is in the key: two screens asking for
 * different depths must not share one cached list, and the gateway clamps it
 * to 1-200 regardless.
 */
export function useProfileChangeLog({ limit = 50 }: { limit?: number } = {}) {
  const { isAuthenticated } = useSession();

  const query = useQuery<ProfileChangeLogEntry[]>({
    queryKey: [...CHANGE_LOG_KEY, limit],
    queryFn: () => caregiversApi.fetchMyProfileChangeLog(limit),
    enabled: isAuthenticated,
  });

  return {
    entries: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}
