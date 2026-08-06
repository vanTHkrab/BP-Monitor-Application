/**
 * GraphQL payloads → domain types.
 *
 * Same split as `modules/auth/lib/mappers.ts`: dates become `Date` here and
 * nowhere else, and `null` becomes `undefined` so the rest of the module can
 * use plain optional chaining rather than checking two empty values.
 */
// Aliased: this file already has a `parseStatus` for caregiver-link status,
// and the two answer completely different questions. Deep import to avoid the
// caregivers → readings → caregivers cycle the barrel would create.
import { parseStatus as parseBpStatus } from '../../readings/lib/status';
// Deep import for the reason `types.ts` gives: `@/modules/auth`'s barrel
// reaches AsyncStorage through `bootstrap.ts`, and a mapper must stay pure.
import type { Gender } from '../../auth/types';
import { parseRelationship } from './relationship';
import type {
  CaregiverLink,
  CaregiverLinkStatus,
  PatientHealthProfile,
  PatientSummary,
  ProfileChangeLogEntry,
} from '../types';

export type CaregiverLinkPayload = {
  caregiverId: string;
  patientId: string;
  relationship: string;
  caregiverName: string;
  caregiverPhone: string;
  /** Nullable so a gateway that predates the field still parses. */
  caregiverAvatar?: string | null;
  patientName: string;
  patientPhone: string;
  patientAvatar?: string | null;
  status: string;
  respondedAt: string | null;
  /** Nullable so a gateway that predates the field still parses. */
  permission?: string | null;
};

export type PatientSummaryPayload = {
  id: string;
  firstname: string;
  lastname: string;
  phone: string;
  avatar: string | null;
  dob: string | null;
  relationship: string | null;
  /** Nullable so a gateway that predates the column still parses. */
  permission?: string | null;
  latestReading?: {
    systolic: number;
    diastolic: number;
    pulse: number;
    status: string;
    measuredAt: string;
  } | null;
  weight: number | null;
  height: number | null;
};

/** Unknown statuses collapse to `pending`: it is the only one that shows the
 *  patient an action, so an unrecognised value fails toward asking rather
 *  than toward silently granting access. */
function parseStatus(value: string): CaregiverLinkStatus {
  return value === 'accepted' || value === 'rejected' ? value : 'pending';
}

export function caregiverLinkFromGql(payload: CaregiverLinkPayload): CaregiverLink {
  return {
    caregiverId: payload.caregiverId,
    patientId: payload.patientId,
    relationship: parseRelationship(payload.relationship),
    caregiverName: payload.caregiverName,
    caregiverPhone: payload.caregiverPhone,
    caregiverAvatar: payload.caregiverAvatar ?? undefined,
    patientName: payload.patientName,
    patientPhone: payload.patientPhone,
    patientAvatar: payload.patientAvatar ?? undefined,
    status: parseStatus(payload.status),
    respondedAt: payload.respondedAt ? new Date(payload.respondedAt) : undefined,
    // Same fallback and same reason as `patientSummaryFromGql`: an older
    // gateway that omits the field must not make every link look read-only,
    // and the server is what actually enforces the grant.
    permission: payload.permission === 'view' ? 'view' : 'full',
  };
}

export function patientSummaryFromGql(payload: PatientSummaryPayload): PatientSummary {
  return {
    id: payload.id,
    firstname: payload.firstname,
    lastname: payload.lastname,
    phone: payload.phone,
    avatar: payload.avatar ?? undefined,
    dob: payload.dob ? new Date(payload.dob) : undefined,
    relationship: payload.relationship ? parseRelationship(payload.relationship) : undefined,
    // Unknown values fall to `full`, matching the column default — an older
    // gateway that omits the field must not lock every caregiver out of
    // recording, and the server refuses the write regardless.
    permission: payload.permission === 'view' ? 'view' : 'full',
    latestReading: payload.latestReading
      ? {
          systolic: payload.latestReading.systolic,
          diastolic: payload.latestReading.diastolic,
          pulse: payload.latestReading.pulse,
          status: parseBpStatus(payload.latestReading.status),
          measuredAt: new Date(payload.latestReading.measuredAt),
        }
      : undefined,
    weight: payload.weight ?? undefined,
    height: payload.height ?? undefined,
  };
}

export type PatientHealthProfilePayload = {
  patientId: string;
  dob: string | null;
  gender: string | null;
  weight: number | null;
  height: number | null;
  congenitalDisease: string | null;
};

export type ProfileChangeLogPayload = {
  id: string;
  actorId: string | null;
  actorName: string;
  byPatient: boolean;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  changedAt: string;
};

/**
 * Unknown gender values collapse to `undefined` rather than being passed
 * through: the form renders gender as a fixed set of choices, and a value
 * outside that set would select nothing while still counting as "set" — so
 * saving the form would silently rewrite the column to whatever *was*
 * selected. `undefined` makes the field honestly blank.
 */
function parseGender(value: string | null): Gender | undefined {
  return value === 'male' || value === 'female' || value === 'other' ? value : undefined;
}

export function patientHealthProfileFromGql(
  payload: PatientHealthProfilePayload,
): PatientHealthProfile {
  return {
    patientId: payload.patientId,
    dob: payload.dob ? new Date(payload.dob) : undefined,
    gender: parseGender(payload.gender),
    weight: payload.weight ?? undefined,
    height: payload.height ?? undefined,
    congenitalDisease: payload.congenitalDisease ?? undefined,
  };
}

/**
 * `field` is passed through unnarrowed on purpose.
 *
 * Every row this app writes carries one of the five `HEALTH_FIELDS`, but the
 * gateway owns that list and could add a sixth before this client ships
 * again. Collapsing an unrecognised name to a placeholder would tell the
 * patient a change happened to something the screen refuses to name, which is
 * worse than the raw column name in a log whose entire job is oversight —
 * `healthFieldLabel` falls back to it for exactly that reason.
 */
export function profileChangeLogEntryFromGql(
  payload: ProfileChangeLogPayload,
): ProfileChangeLogEntry {
  return {
    id: payload.id,
    actorId: payload.actorId ?? undefined,
    actorName: payload.actorName,
    byPatient: payload.byPatient,
    field: payload.field,
    oldValue: payload.oldValue ?? undefined,
    newValue: payload.newValue ?? undefined,
    changedAt: new Date(payload.changedAt),
  };
}
