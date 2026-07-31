/**
 * Auth domain types.
 *
 * Shapes mirror `server/app/api-gateway/src/schema.gql` (`UserType`,
 * `SessionType`, `RegisterInput`). The generated schema is the contract —
 * when it moves, this file moves with it in the same change.
 */

/** Matches the gateway's `UserRole`. `developer` exists but is never assignable at sign-up. */
export type UserRole = 'patient' | 'caregiver' | 'developer';

export type Gender = 'male' | 'female' | 'other';

/**
 * `email` is optional here even though registration now requires one: the
 * GraphQL `UserType.email` is still nullable, and rows created before the
 * Better Auth migration can still come back without one.
 */
export type User = {
  id: string;
  firstname: string;
  lastname: string;
  phone: string;
  email?: string;
  avatar?: string;
  role: UserRole;
  /**
   * When the user picked their own role in onboarding; absent if they never
   * have. The onboarding gate reads this, **not** `role` — `role` defaults
   * to `patient`, so it cannot distinguish "chose patient" from "never
   * chose".
   */
  roleSelectedAt?: Date;
  createdAt: Date;
  dob?: Date;
  gender?: Gender;
  weight?: number;
  height?: number;
  congenitalDisease?: string;
};

export type LoginSession = {
  id: string;
  deviceLabel?: string;
  userAgent?: string;
  isActive: boolean;
  revokedAt?: Date;
  lastActiveAt: Date;
  createdAt: Date;
};

export type LoginInput = {
  phone: string;
  password: string;
};

/**
 * Two changes from the pre-Better-Auth shape, both breaking:
 *   - `email` is required. A registration without one is rejected before it
 *     reaches the resolver.
 *   - `role` is gone. Sending it is a GraphQL validation error, because
 *     accepting it at sign-up would let a client make itself a developer.
 */
export type RegisterInput = {
  firstname: string;
  lastname: string;
  phone: string;
  password: string;
  email: string;
  dob?: Date;
  gender?: Gender;
  weight?: number;
  height?: number;
  congenitalDisease?: string;
};

/** Which input an auth error attaches to, for inline form errors. */
export type AuthErrorField = 'phone' | 'email' | 'password' | 'both' | null;

export type AuthErrorView = {
  /** User-facing Thai message. Never carries raw English or an error code. */
  message: string;
  field: AuthErrorField;
  /** Seconds to wait before retrying, when the server throttled us. */
  retryAfterSec: number | null;
};
