/**
 * GraphQL payload → domain type.
 *
 * Pure. Exists so date parsing and the nullable → optional conversion happen
 * in exactly one place: `UserType.email` and friends come back as `null`
 * from GraphQL, and `null` in an optional field reads as "present but empty"
 * at every call site downstream.
 */
import type { Gender, LoginSession, User, UserRole } from '../types';

export type UserPayload = {
  id: string;
  firstname: string;
  lastname: string;
  phone: string;
  email?: string | null;
  emailVerified: boolean;
  avatar?: string | null;
  role: string;
  roleSelectedAt?: string | null;
  createdAt: string;
  dob?: string | null;
  gender?: string | null;
  weight?: number | null;
  height?: number | null;
  congenitalDisease?: string | null;
};

export type SessionPayload = {
  id: string;
  deviceLabel?: string | null;
  userAgent?: string | null;
  isActive: boolean;
  revokedAt?: string | null;
  lastActiveAt: string;
  createdAt: string;
};

const ROLES: readonly UserRole[] = ['patient', 'caregiver', 'developer'];
const GENDERS: readonly Gender[] = ['male', 'female', 'other'];

/**
 * `role` is a plain `String!` on the wire, so an unrecognised value is
 * reachable — a gateway that adds a role before the app ships gets treated
 * as the least-privileged one rather than crashing a screen.
 */
const parseRole = (value: string): UserRole =>
  (ROLES as readonly string[]).includes(value) ? (value as UserRole) : 'patient';

const parseGender = (value?: string | null): Gender | undefined =>
  value && (GENDERS as readonly string[]).includes(value) ? (value as Gender) : undefined;

const optionalDate = (value?: string | null): Date | undefined =>
  value ? new Date(value) : undefined;

const optionalNumber = (value?: number | null): number | undefined =>
  typeof value === 'number' ? value : undefined;

export const userFromGql = (payload: UserPayload): User => ({
  id: payload.id,
  firstname: payload.firstname,
  lastname: payload.lastname,
  phone: payload.phone,
  email: payload.email ?? undefined,
  emailVerified: payload.emailVerified,
  avatar: payload.avatar ?? undefined,
  role: parseRole(payload.role),
  roleSelectedAt: optionalDate(payload.roleSelectedAt),
  createdAt: new Date(payload.createdAt),
  dob: optionalDate(payload.dob),
  gender: parseGender(payload.gender),
  weight: optionalNumber(payload.weight),
  height: optionalNumber(payload.height),
  congenitalDisease: payload.congenitalDisease ?? undefined,
});

export const sessionFromGql = (payload: SessionPayload): LoginSession => ({
  id: payload.id,
  deviceLabel: payload.deviceLabel ?? undefined,
  userAgent: payload.userAgent ?? undefined,
  isActive: Boolean(payload.isActive),
  revokedAt: optionalDate(payload.revokedAt),
  lastActiveAt: new Date(payload.lastActiveAt),
  createdAt: new Date(payload.createdAt),
});
