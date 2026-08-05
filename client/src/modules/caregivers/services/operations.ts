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
    }
  }
`;

export const GQL_ADD_CAREGIVER_PATIENT = `
  mutation AddCaregiverPatient($patientPhone: String!, $relationship: String!) {
    addCaregiverPatient(patientPhone: $patientPhone, relationship: $relationship) {
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
    }
  }
`;

export const GQL_REMOVE_CAREGIVER_PATIENT = `
  mutation RemoveCaregiverPatient($caregiverId: String!, $patientId: String!) {
    removeCaregiverPatient(caregiverId: $caregiverId, patientId: $patientId)
  }
`;
