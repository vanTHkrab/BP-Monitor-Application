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
export { initAuth, registerSessionExpiryHandler } from './bootstrap';
export { resolveGate, type GateDestination } from './route-gate';

export { useLogin } from './hooks/use-login';
export { useLogout } from './hooks/use-logout';
export { useRegister } from './hooks/use-register';
export { useSession } from './hooks/use-session';

export { formatAuthError, type FormatAuthErrorOptions } from './lib/errors';

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
