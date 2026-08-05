/**
 * The gateway side of the invitations screen. I/O only — it calls, maps, and
 * returns; it does not touch a store and it does not format errors.
 */
import { graphqlRequest } from '@/services/api';
import { stripPhoneDigits } from '@/utils/phone-format';

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
 * The phone is stripped to digits here rather than in the form, because the
 * gateway does an exact `User.phone` lookup: a display-formatted
 * "081-234-5678" finds nobody and surfaces as "ไม่พบผู้ใช้จากเบอร์นี้", which
 * is a lie about why it failed.
 */
export async function invitePatient(input: InvitePatientInput): Promise<CaregiverLink> {
  const data = await graphqlRequest<{ addCaregiverPatient: CaregiverLinkPayload }>(
    GQL_ADD_CAREGIVER_PATIENT,
    {
      patientPhone: stripPhoneDigits(input.patientPhone),
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
