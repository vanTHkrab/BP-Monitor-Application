/**
 * Public surface of the auth module. Screens import from here, never from a
 * file inside — that is what lets the internals move without a sweep of
 * `app/(auth)/`.
 *
 * `services/*` is deliberately not re-exported. A screen calling the GraphQL
 * layer directly would bypass the store write and the query invalidation the
 * hooks own, which is exactly how a "signed in but the UI disagrees" bug
 * gets made.
 */
export {
  initAuth,
  registerSessionExpiryHandler,
  registerSessionUserMirror,
} from './bootstrap';
export { resolveGate, type GateDestination } from './route-gate';

export { useChangePassword } from './hooks/use-change-password';
export { useDeleteMyData } from './hooks/use-delete-my-data';
export {
  isGoogleSignInConfigured,
  useGoogleSignIn,
} from './hooks/use-google-sign-in';
export { useLogin } from './hooks/use-login';
export { useLoginSessions, useLogoutAllDevices } from './hooks/use-login-sessions';
export { useLogout } from './hooks/use-logout';
export { useRegister } from './hooks/use-register';
export { useSession } from './hooks/use-session';
export { useSetPhone } from './hooks/use-set-phone';
export { useUpdateProfile, type UpdateProfileInput } from './hooks/use-update-profile';
export { useVerifyEmail } from './hooks/use-verify-email';

export {
  formatAuthError,
  googleSignInRefusalMessage,
  type FormatAuthErrorOptions,
} from './lib/errors';

export type {
  AuthErrorField,
  AuthErrorView,
  Gender,
  LoginInput,
  LoginSession,
  RegisterInput,
  User,
  UserRole,
} from './types';
