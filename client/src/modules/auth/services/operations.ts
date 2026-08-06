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
  emailVerified
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

/**
 * Google sign-in from the on-device account picker (One Tap).
 *
 * The gateway verifies the ID token against Google before it means anything;
 * the client never sees a session until that succeeds. Same payload shape as
 * `login`, so the caller's session bootstrap needs no branch of its own.
 */
export const GQL_LOGIN_WITH_GOOGLE = `
  mutation LoginWithGoogle($input: GoogleSignInInput!) {
    loginWithGoogle(input: $input) {
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

/**
 * `pushToken` is this installation's Expo push token, and passing it is not
 * optional in practice.
 *
 * A `PushToken` row is deliberately not session-scoped on the gateway — an
 * Expo token belongs to the app installation and has to survive session
 * rotation — so the server cannot infer which installation is signing out.
 * Omit the argument and nothing is unregistered: the phone stays subscribed
 * and keeps receiving a patient's critical readings after the caregiver has
 * signed out of it. On a shared handset that is a disclosure, not noise.
 *
 * Nullable because a device may genuinely have none: Expo Go on Android
 * cannot obtain a token at all, and a logout must not fail over that.
 */
export const GQL_LOGOUT = `
  mutation Logout($pushToken: String) {
    logout(pushToken: $pushToken)
  }
`;

/**
 * Same argument, **opposite meaning** — the gateway reads it as
 * `keepPushToken`. `logoutAllDevices` signs out every *other* device and drops
 * every other installation's token, keeping the one it is given. Passing this
 * device's token is therefore what stops "sign out everywhere else" from
 * unsubscribing the phone in your hand.
 */
export const GQL_LOGOUT_ALL_DEVICES = `
  mutation LogoutAllDevices($pushToken: String) {
    logoutAllDevices(pushToken: $pushToken)
  }
`;

export const GQL_DELETE_MY_DATA = `
  mutation DeleteMyData {
    deleteMyData
  }
`;
