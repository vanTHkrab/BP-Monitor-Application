/**
 * The gateway side of auth. I/O only — it calls, maps, and returns; it does
 * not touch the store and it does not format errors for display.
 *
 * Errors propagate as the transport's `ApiError` so the caller can run them
 * through `formatAuthError` with the right context. Swallowing them here
 * would cost the field hints and the throttle countdown.
 */
import { graphqlRequest } from '@/services/api';
import type { LoginInput, LoginSession, RegisterInput, User } from '../types';
import { sessionFromGql, userFromGql, type SessionPayload, type UserPayload } from '../lib/mappers';
import {
  GQL_CHANGE_PASSWORD,
  GQL_DELETE_MY_DATA,
  GQL_LOGIN,
  GQL_LOGIN_WITH_GOOGLE,
  GQL_LOGIN_SESSIONS,
  GQL_LOGOUT,
  GQL_LOGOUT_ALL_DEVICES,
  GQL_ME,
  GQL_REGISTER,
  GQL_UPDATE_PROFILE,
} from './operations';

export type AuthResult = {
  /** Better Auth session token. The bearer bridge accepts it as a cookie. */
  token: string;
  user: User;
};

type AuthPayload = { token: string; user: UserPayload };

/**
 * Labels the session row so the "login sessions" screen has something
 * readable to show. `Platform.OS` rather than a device name: the latter
 * needs a permission on Android and adds nothing for this purpose.
 */
function deviceLabel(): string {
  switch (process.env.EXPO_OS) {
    case 'ios':
      return 'iPhone App';
    case 'android':
      return 'Android App';
    default:
      return 'Web App';
  }
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const data = await graphqlRequest<{ login: AuthPayload }>(GQL_LOGIN, {
    input: { ...input, deviceLabel: deviceLabel() },
  });
  return { token: data.login.token, user: userFromGql(data.login.user) };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const data = await graphqlRequest<{ register: AuthPayload }>(GQL_REGISTER, {
    input: {
      firstname: input.firstname,
      lastname: input.lastname,
      phone: input.phone,
      password: input.password,
      // Required since the Better Auth migration. Sending `role` is now a
      // GraphQL validation error, so it is absent by construction here.
      email: input.email,
      dob: input.dob?.toISOString(),
      gender: input.gender,
      weight: input.weight,
      height: input.height,
      congenitalDisease: input.congenitalDisease || undefined,
      deviceLabel: deviceLabel(),
    },
  });
  return { token: data.register.token, user: userFromGql(data.register.user) };
}

export async function fetchMe(): Promise<User> {
  const data = await graphqlRequest<{ me: UserPayload }>(GQL_ME);
  return userFromGql(data.me);
}

/**
 * Partial update — only the fields present are written.
 *
 * Absent and `null` are different instructions, and the difference is the
 * whole reason the optional columns accept `null` here. The gateway writes a
 * column only when the key is present (`if (data.dob !== undefined)`) and
 * clears it when the value is empty (`patch.dob = data.dob || null`), so
 * omitting a field leaves it alone while sending `null` erases it. Typing
 * these as `number | undefined` would have made "clear my weight"
 * unexpressible: `undefined` is dropped by JSON serialisation before the
 * request goes out, so it reads on the server as "leave it".
 *
 * `email` is accepted by the schema and deliberately not offered here — see
 * the header of `app/profile.tsx`.
 */
export async function updateProfile(input: {
  firstname?: string;
  lastname?: string;
  phone?: string;
  avatar?: string;
  dob?: string | null;
  gender?: string | null;
  weight?: number | null;
  height?: number | null;
  congenitalDisease?: string | null;
}): Promise<User> {
  const data = await graphqlRequest<{ updateProfile: UserPayload }>(GQL_UPDATE_PROFILE, { input });
  return userFromGql(data.updateProfile);
}

export async function fetchLoginSessions(): Promise<LoginSession[]> {
  const data = await graphqlRequest<{ loginSessions: SessionPayload[] }>(GQL_LOGIN_SESSIONS);
  return data.loginSessions.map(sessionFromGql);
}

/**
 * Revokes the current session server-side. The caller still clears locally.
 *
 * `pushToken` is this installation's, and it is what tells the gateway which
 * `PushToken` row to delete — see the note on `GQL_LOGOUT`. `undefined` when
 * this device never registered one.
 */
export async function logout(pushToken?: string): Promise<void> {
  await graphqlRequest<{ logout: boolean }>(GQL_LOGOUT, {
    pushToken: pushToken ?? null,
  });
}

/**
 * Here the same token means "keep this one" — every other installation's is
 * dropped along with its session. See `GQL_LOGOUT_ALL_DEVICES`.
 */
export async function logoutAllDevices(pushToken?: string): Promise<void> {
  await graphqlRequest<{ logoutAllDevices: boolean }>(GQL_LOGOUT_ALL_DEVICES, {
    pushToken: pushToken ?? null,
  });
}

export async function deleteMyData(): Promise<void> {
  await graphqlRequest<{ deleteMyData: boolean }>(GQL_DELETE_MY_DATA);
}

/**
 * Changes the password and revokes every *other* session server-side.
 *
 * The revocation is the gateway's, not a second call from here: a leaked
 * token elsewhere has to stop working the moment the password changes, and
 * doing that client-side would leave a window if the app is killed in
 * between. This device stays signed in.
 */
export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await graphqlRequest<{ changePassword: boolean }>(GQL_CHANGE_PASSWORD, { input });
}

/** Signs in with a Google ID token from the on-device account picker. */
export async function loginWithGoogle(idToken: string): Promise<AuthResult> {
  const data = await graphqlRequest<{ loginWithGoogle: AuthPayload }>(GQL_LOGIN_WITH_GOOGLE, {
    input: { idToken, deviceLabel: deviceLabel() },
  });
  return {
    token: data.loginWithGoogle.token,
    user: userFromGql(data.loginWithGoogle.user),
  };
}
