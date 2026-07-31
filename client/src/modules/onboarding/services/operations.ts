/**
 * Onboarding GraphQL operations.
 *
 * `roleSelectedAt` is requested everywhere the user comes back, because it —
 * not `role` — is what the gate reads.
 */
export const GQL_SELECT_ROLE = `
  mutation SelectRole($input: SelectRoleInput!) {
    selectRole(input: $input) {
      id
      firstname
      lastname
      phone
      email
      avatar
      role
      roleSelectedAt
      createdAt
      dob
      gender
      weight
      height
      congenitalDisease
    }
  }
`;
