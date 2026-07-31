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
  GQL_DELETE_MY_DATA,
  GQL_LOGIN,
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

/** Partial update — only the fields present are written. */
export async function updateProfile(input: {
  firstname?: string;
  lastname?: string;
  phone?: string;
  avatar?: string;
  dob?: string;
  gender?: string;
  weight?: number;
  height?: number;
  congenitalDisease?: string;
}): Promise<User> {
  const data = await graphqlRequest<{ updateProfile: UserPayload }>(GQL_UPDATE_PROFILE, { input });
  return userFromGql(data.updateProfile);
}

export async function fetchLoginSessions(): Promise<LoginSession[]> {
  const data = await graphqlRequest<{ loginSessions: SessionPayload[] }>(GQL_LOGIN_SESSIONS);
  return data.loginSessions.map(sessionFromGql);
}

/** Revokes the current session server-side. The caller still clears locally. */
export async function logout(): Promise<void> {
  await graphqlRequest<{ logout: boolean }>(GQL_LOGOUT);
}

export async function logoutAllDevices(): Promise<void> {
  await graphqlRequest<{ logoutAllDevices: boolean }>(GQL_LOGOUT_ALL_DEVICES);
}

export async function deleteMyData(): Promise<void> {
  await graphqlRequest<{ deleteMyData: boolean }>(GQL_DELETE_MY_DATA);
}
