/**
 * The ten auth GraphQL operations.
 *
 * Better Auth sits behind these as thin wrappers, so the names and shapes
 * are unchanged from the pre-migration client — only the gateway's
 * implementation moved. Field lists mirror `UserType` / `SessionType` in
 * `server/app/api-gateway/src/schema.gql`.
 */

/** Shared selection so `login`, `register`, and `me` can never drift apart. */
const USER_FIELDS = `
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
`;

export const GQL_LOGIN = `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      token
      user { ${USER_FIELDS} }
    }
  }
`;

export const GQL_REGISTER = `
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      token
      user { ${USER_FIELDS} }
    }
  }
`;

export const GQL_ME = `
  query Me {
    me { ${USER_FIELDS} }
  }
`;

export const GQL_UPDATE_PROFILE = `
  mutation UpdateProfile($input: UpdateProfileInput!) {
    updateProfile(input: $input) { ${USER_FIELDS} }
  }
`;

export const GQL_CHANGE_PASSWORD = `
  mutation ChangePassword($input: ChangePasswordInput!) {
    changePassword(input: $input)
  }
`;

export const GQL_VERIFY_PASSWORD = `
  mutation VerifyPassword($password: String!) {
    verifyPassword(password: $password)
  }
`;

export const GQL_LOGIN_SESSIONS = `
  query LoginSessions {
    loginSessions {
      id
      deviceLabel
      userAgent
      isActive
      revokedAt
      lastActiveAt
      createdAt
    }
  }
`;

export const GQL_LOGOUT = `
  mutation Logout {
    logout
  }
`;

export const GQL_LOGOUT_ALL_DEVICES = `
  mutation LogoutAllDevices {
    logoutAllDevices
  }
`;

export const GQL_DELETE_MY_DATA = `
  mutation DeleteMyData {
    deleteMyData
  }
`;
