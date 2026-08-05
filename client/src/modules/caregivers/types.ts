/**
 * Caregiver-link domain types.
 *
 * Shapes mirror `server/app/api-gateway/src/schema.gql` (`CaregiverLinkType`,
 * `PatientSummaryType`, `CaregiverLinkStatus`). The generated schema is the
 * contract — when it moves, this file moves with it in the same change.
 */

/** Matches the gateway's `CaregiverLinkStatus`. */
export type CaregiverLinkStatus = 'pending' | 'accepted' | 'rejected';

/**
 * Matches Prisma's `RelationshipType`. Nine values exist in the database, but
 * only seven are *accepted* on the way in: `caregiver.service.ts`'s
 * `VALID_RELATIONSHIPS` omits `patient` and `caregiver`, so anything else —
 * including the schema's own `relationship: String! = "caregiver"` default —
 * is silently stored as `other`. Rows written before that rule can still come
 * back as either, so both stay in the union and both get a label.
 */
export type RelationshipType =
  | 'parent'
  | 'child'
  | 'spouse'
  | 'sibling'
  | 'friend'
  | 'caregiver_professional'
  | 'other'
  | 'patient'
  | 'caregiver';

/**
 * One caregiver↔patient edge, as both sides see it.
 *
 * Symmetric on purpose: the gateway returns the same row to the caregiver and
 * to the patient, and the caller decides which side it is on by comparing
 * `caregiverId` to its own user id. There is no separate "my invites" shape.
 */
export type CaregiverLink = {
  caregiverId: string;
  patientId: string;
  relationship: RelationshipType;
  caregiverName: string;
  caregiverPhone: string;
  patientName: string;
  patientPhone: string;
  status: CaregiverLinkStatus;
  /** When the patient accepted or rejected; absent while still pending. */
  respondedAt?: Date;
};

/** A patient a caregiver has an **accepted** link to. */
export type PatientSummary = {
  id: string;
  firstname: string;
  lastname: string;
  phone: string;
  avatar?: string;
  dob?: Date;
  relationship?: RelationshipType;
  /**
   * What this caregiver's accepted link permits.
   *
   * `view` may read the patient's history and alerts; `full` may also record
   * readings on their behalf. The gateway enforces it either way — this is
   * here so the app can refuse a write *before* someone takes a measurement
   * it was never going to be allowed to save.
   *
   * Defaults to `full` when the server omits it, matching the column default:
   * a client built against an older gateway keeps working rather than locking
   * every caregiver out of recording.
   */
  permission: CaregiverPermission;
  weight?: number;
  height?: number;
};

/** Mirrors the gateway's `CaregiverPermission` enum. */
export type CaregiverPermission = 'view' | 'full';

export type InvitePatientInput = {
  /** Digits only — the gateway looks this up as an exact `User.phone` match. */
  patientPhone: string;
  relationship: RelationshipType;
};
