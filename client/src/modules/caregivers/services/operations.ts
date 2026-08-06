/**
 * Caregiver-link GraphQL operations.
 *
 * `caregiverLinks` is the one read the screen is built on. The gateway also
 * exposes `myPendingInvites`, but it returns exactly the rows
 * `caregiverLinks` already contains where `patientId === me && status ===
 * pending` — querying both would mean two caches that can disagree about
 * whether an invite is still waiting, which is the one thing this screen must
 * be right about. `myPatients` is fetched as well because it carries the
 * patient's `id` and `avatar`, which the symmetric link row does not.
 */

export const GQL_CAREGIVER_LINKS = `
  query CaregiverLinks {
    caregiverLinks {
      caregiverId
      patientId
      relationship
      caregiverName
      caregiverPhone
      caregiverAvatar
      patientName
      patientPhone
      patientAvatar
      status
      respondedAt
      permission
    }
  }
`;

export const GQL_MY_PATIENTS = `
  query MyPatients {
    myPatients {
      id
      firstname
      lastname
      phone
      avatar
      dob
      relationship
      permission
      latestReading {
        systolic
        diastolic
        pulse
        status
        measuredAt
      }
      weight
      height
      gender
      congenitalDisease
    }
  }
`;

export const GQL_ADD_CAREGIVER_PATIENT = `
  mutation AddCaregiverPatient($patientContact: String!, $relationship: String!) {
    addCaregiverPatient(patientContact: $patientContact, relationship: $relationship) {
      caregiverId
      patientId
      relationship
      caregiverName
      caregiverPhone
      caregiverAvatar
      patientName
      patientPhone
      patientAvatar
      status
      respondedAt
      permission
    }
  }
`;

/**
 * `$permission` is a `CaregiverPermission` enum, not a String — an
 * unrecognised value fails validation at the gateway's door rather than
 * being parsed down to something plausible. It is only meaningful when
 * `$accept` is true.
 */
export const GQL_RESPOND_TO_CAREGIVER_INVITE = `
  mutation RespondToCaregiverInvite($caregiverId: String!, $accept: Boolean!, $permission: CaregiverPermission!) {
    respondToCaregiverInvite(caregiverId: $caregiverId, accept: $accept, permission: $permission) {
      caregiverId
      patientId
      relationship
      caregiverName
      caregiverPhone
      caregiverAvatar
      patientName
      patientPhone
      patientAvatar
      status
      respondedAt
      permission
    }
  }
`;

export const GQL_REMOVE_CAREGIVER_PATIENT = `
  mutation RemoveCaregiverPatient($caregiverId: String!, $patientId: String!) {
    removeCaregiverPatient(caregiverId: $caregiverId, patientId: $patientId)
  }
`;

/**
 * The patient changes a grant they already made.
 *
 * There is no `patientId` argument by design — the gateway takes it from the
 * session, so this can only ever address a link where the caller is the
 * patient. `$permission` is required here even though
 * `respondToCaregiverInvite` defaults it: that default exists for clients
 * written before the argument did, while changing a grant to an unstated
 * value is not a request anyone makes.
 */
export const GQL_UPDATE_CAREGIVER_PERMISSION = `
  mutation UpdateCaregiverPermission($caregiverId: String!, $permission: CaregiverPermission!) {
    updateCaregiverPermission(caregiverId: $caregiverId, permission: $permission) {
      caregiverId
      patientId
      relationship
      caregiverName
      caregiverPhone
      caregiverAvatar
      patientName
      patientPhone
      patientAvatar
      status
      respondedAt
      permission
    }
  }
`;

/**
 * A caregiver with an accepted `full` link edits their patient's health
 * information.
 *
 * **Five fields, and the input type is what keeps it to five.**
 * `UpdatePatientHealthInput` exists on the gateway precisely so this path
 * cannot reach `email` or `phone` — both are unique login identities, and a
 * caregiver who could change the email could request a password reset and
 * take the account. `firstname`, `lastname` and `avatar` are absent for the
 * milder reason that they are the patient's own presentation, not a health
 * record. Reusing `UpdateProfileInput` here would put all five back within
 * reach of a one-line mistake, so this operation does not mention it.
 *
 * An **absent** key means "leave this column alone"; an explicit `null`
 * clears it. `lib/health-form.ts` is what decides which, and the distinction
 * is the only reason a form that cannot read `gender` is safe to submit.
 *
 * The selection is the whole returned profile rather than just the patient
 * id: it is the only read path a caregiver has for `gender` and
 * `congenitalDisease` (see `health-form.ts`), so throwing it away would mean
 * the form still cannot show what it just wrote.
 */
export const GQL_UPDATE_PATIENT_HEALTH = `
  mutation UpdatePatientHealth($patientId: String!, $input: UpdatePatientHealthInput!) {
    updatePatientHealth(patientId: $patientId, input: $input) {
      patientId
      dob
      gender
      weight
      height
      congenitalDisease
    }
  }
`;

/**
 * The patient's own record of who changed their health information.
 *
 * No `patientId` argument by design — the gateway takes it from the session,
 * so this cannot be aimed at anyone else's trail. There is deliberately **no
 * caregiver-facing counterpart**: every row carries the health values on both
 * sides of the change, so a caregiver later downgraded to `view` would keep a
 * readable window onto data they can no longer see. Filtering by actor does
 * not help — those are exactly the rows holding the data.
 *
 * That is why `app/profile-changes.tsx` mounts `SecurityHeader` with
 * `subject="self"` and why its entry point is hidden while a caregiver is
 * inside a patient: the query answers about the session, and a screen titled
 * with the patient's context would be describing the wrong person's log.
 */
export const GQL_MY_PROFILE_CHANGE_LOG = `
  query MyProfileChangeLog($limit: Int!) {
    myProfileChangeLog(limit: $limit) {
      id
      actorId
      actorName
      byPatient
      field
      oldValue
      newValue
      changedAt
    }
  }
`;
