/**
 * The gateway side of the invitations screen. I/O only — it calls, maps, and
 * returns; it does not touch a store and it does not format errors.
 */
import { graphqlRequest } from '@/services/api';

import { prepareContact } from '../lib/contact';
import {
  caregiverLinkFromGql,
  patientSummaryFromGql,
  type CaregiverLinkPayload,
  type PatientSummaryPayload,
} from '../lib/mappers';
import type {
  CaregiverLink,
  CaregiverPermission,
  InvitePatientInput,
  PatientSummary,
} from '../types';
import {
  GQL_ADD_CAREGIVER_PATIENT,
  GQL_CAREGIVER_LINKS,
  GQL_MY_PATIENTS,
  GQL_REMOVE_CAREGIVER_PATIENT,
  GQL_RESPOND_TO_CAREGIVER_INVITE,
  GQL_UPDATE_CAREGIVER_PERMISSION,
} from './operations';

export async function fetchCaregiverLinks(): Promise<CaregiverLink[]> {
  const data = await graphqlRequest<{ caregiverLinks: CaregiverLinkPayload[] }>(
    GQL_CAREGIVER_LINKS,
  );
  return data.caregiverLinks.map(caregiverLinkFromGql);
}

export async function fetchMyPatients(): Promise<PatientSummary[]> {
  const data = await graphqlRequest<{ myPatients: PatientSummaryPayload[] }>(
    GQL_MY_PATIENTS,
  );
  return data.myPatients.map(patientSummaryFromGql);
}

/**
 * The contact is normalised here rather than in the form, so every caller
 * gets it right: `prepareContact` strips a phone to digits (the gateway does
 * an exact `User.phone` match, and "081-234-5678" finds nobody) and leaves an
 * email intact beyond trim + lowercase. Stripping an address to digits would
 * turn it into a phone lookup that cannot succeed.
 */
export async function invitePatient(input: InvitePatientInput): Promise<CaregiverLink> {
  const data = await graphqlRequest<{ addCaregiverPatient: CaregiverLinkPayload }>(
    GQL_ADD_CAREGIVER_PATIENT,
    {
      patientContact: prepareContact(input.patientContact),
      relationship: input.relationship,
    },
  );
  return caregiverLinkFromGql(data.addCaregiverPatient);
}

/**
 * `permission` is what the patient grants, and it is required here rather
 * than defaulted: the gateway defaults it to `full` for older clients, so a
 * caller that forgets to pass it would silently grant write access to
 * someone's medical record. Making it explicit puts that decision at the
 * call site where the patient's answer is.
 *
 * The gateway ignores it when `accept` is false.
 */
export async function respondToInvite(
  caregiverId: string,
  accept: boolean,
  permission: CaregiverPermission,
): Promise<CaregiverLink> {
  const data = await graphqlRequest<{ respondToCaregiverInvite: CaregiverLinkPayload }>(
    GQL_RESPOND_TO_CAREGIVER_INVITE,
    { caregiverId, accept, permission },
  );
  return caregiverLinkFromGql(data.respondToCaregiverInvite);
}

/**
 * Change a grant on an already-accepted link.
 *
 * The gateway refuses anything but an `accepted` link and derives the patient
 * from the session, so this carries no `patientId` to get wrong.
 */
export async function updateCaregiverPermission(
  caregiverId: string,
  permission: CaregiverPermission,
): Promise<CaregiverLink> {
  const data = await graphqlRequest<{ updateCaregiverPermission: CaregiverLinkPayload }>(
    GQL_UPDATE_CAREGIVER_PERMISSION,
    { caregiverId, permission },
  );
  return caregiverLinkFromGql(data.updateCaregiverPermission);
}

export async function removeCaregiverLink(
  caregiverId: string,
  patientId: string,
): Promise<boolean> {
  const data = await graphqlRequest<{ removeCaregiverPatient: boolean }>(
    GQL_REMOVE_CAREGIVER_PATIENT,
    { caregiverId, patientId },
  );
  return data.removeCaregiverPatient;
}
