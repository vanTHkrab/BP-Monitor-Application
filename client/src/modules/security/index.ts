/**
 * Public surface of the security module. Screens import from here, never from
 * a file inside — same rule as `modules/auth`, for the same reason.
 *
 * `services/*` stays unexported: a screen calling the GraphQL layer directly
 * would skip the query invalidation the hooks own, and a passkey list that
 * disagrees with the count on the previous screen is exactly the kind of bug
 * that makes a security screen untrustworthy.
 */
export { promptDeviceUnlock, useAppLock, useAppLockStore } from './hooks/use-app-lock';
export {
  isPasskeyAvailableOnDevice,
  usePasskeySignIn,
} from './hooks/use-passkey-sign-in';
export {
  useDeletePasskey,
  usePasskeys,
  useRegisterPasskey,
  useRenamePasskey,
} from './hooks/use-passkeys';
export { useSecurityOverview } from './hooks/use-security-overview';

export {
  biometricErrorMessage,
  getBiometricCapability,
  type BiometricCapability,
  type BiometricKind,
} from './lib/app-lock';
export {
  assessSecurity,
  describeLoginMethod,
  type PostureTone,
  type SecurityPosture,
} from './lib/security-posture';

export { AppLockGate } from './components/app-lock-gate';
export { SecurityHeader } from './components/security-header';
export { SecurityPostureBanner } from './components/security-posture-banner';
export { SecurityGroup, SecurityRow } from './components/security-row';

export type { LoginMethod, Passkey, SecurityOverview } from './types';
