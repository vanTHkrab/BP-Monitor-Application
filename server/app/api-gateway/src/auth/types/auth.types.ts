// Phone/password constraints. Shared by DTOs so the wire contract is
// defined in one place.
export const PHONE_REGEX = /^[0-9]{9,15}$/; // digits only, 9-15 long (covers TH + intl)
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt's hard input limit

// Keep the JWT payload minimal — only the identifiers the guard needs to
// re-resolve the user. Anything else (phone, role, profile) is loaded from
// the DB on demand so it stays consistent with the source of truth and so a
// leaked token doesn't leak PII along with it.
export interface JwtPayload {
  sub: string; // user id
  sid: string; // session id
}

export interface CurrentUserContext {
  id: string;
  sessionId: string;
}

export type Gender = 'male' | 'female' | 'other';

/**
 * Roles a user may choose for themselves at sign-up.
 *
 * `developer` is deliberately absent and must stay that way: it is the
 * privileged role, and Better Auth accepts additional fields on the sign-up
 * path, so anything not filtered here is self-assignable by any client that
 * can reach `POST /api/auth/sign-up/email`.
 *
 * Prisma's `UserRole` enum is the superset (`patient | caregiver |
 * developer`); this is the subset the outside world may ask for.
 */
export const SELF_ASSIGNABLE_ROLES = ['patient', 'caregiver'] as const;

export type SelfAssignableRole = (typeof SELF_ASSIGNABLE_ROLES)[number];

export const DEFAULT_ROLE: SelfAssignableRole = 'patient';

/**
 * Collapses whatever a request carried into a role we are willing to grant.
 *
 * Fails closed by design — anything unrecognised, missing, or privileged
 * becomes `patient`.
 *
 * Called in two places, deliberately:
 *
 *  1. `databaseHooks.user.create.before` — sets the default on every
 *     account-creation path, and keeps failing closed if `role` ever becomes
 *     writable at sign-up again.
 *  2. `AuthService.register` — the post-create update that actually applies a
 *     self-selected role. That is the write which grants privilege, so it
 *     re-validates rather than trusting the DTO enum upstream of it.
 *
 * The role cannot be set during sign-up itself: Better Auth's `admin` plugin
 * declares `role` with `input: false`, and a sign-up carrying one is rejected
 * with "role is not allowed to be set".
 */
export function normalizeSelfAssignedRole(value: unknown): SelfAssignableRole {
  return SELF_ASSIGNABLE_ROLES.includes(value as SelfAssignableRole)
    ? (value as SelfAssignableRole)
    : DEFAULT_ROLE;
}
