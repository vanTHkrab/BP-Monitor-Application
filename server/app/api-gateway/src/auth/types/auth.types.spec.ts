import {
  DEFAULT_ROLE,
  SELF_ASSIGNABLE_ROLES,
  normalizeSelfAssignedRole,
} from './auth.types';

describe('normalizeSelfAssignedRole', () => {
  it('keeps the roles a user is allowed to choose', () => {
    expect(normalizeSelfAssignedRole('patient')).toBe('patient');
    expect(normalizeSelfAssignedRole('caregiver')).toBe('caregiver');
  });

  it('refuses to grant developer', () => {
    // The whole reason this function exists. Better Auth accepts additional
    // fields on `/api/auth/sign-up/*`, so a client that can reach that route
    // would otherwise be able to make itself privileged.
    expect(normalizeSelfAssignedRole('developer')).toBe('patient');
  });

  it('falls back to patient for anything unrecognised', () => {
    expect(normalizeSelfAssignedRole('admin')).toBe('patient');
    expect(normalizeSelfAssignedRole('')).toBe('patient');
    expect(normalizeSelfAssignedRole('Patient')).toBe('patient');
    expect(normalizeSelfAssignedRole('PATIENT')).toBe('patient');
  });

  it('falls back to patient when the field is absent', () => {
    // The Google OAuth callback creates a user carrying no role at all.
    expect(normalizeSelfAssignedRole(undefined)).toBe('patient');
    expect(normalizeSelfAssignedRole(null)).toBe('patient');
  });

  it('fails closed on non-string input rather than passing it through', () => {
    // A JSON body can carry any type; an object reaching the role column
    // would be a Prisma enum error at best and a stored surprise at worst.
    expect(normalizeSelfAssignedRole({ role: 'developer' })).toBe('patient');
    expect(normalizeSelfAssignedRole(['caregiver'])).toBe('patient');
    expect(normalizeSelfAssignedRole(1)).toBe('patient');
    expect(normalizeSelfAssignedRole(true)).toBe('patient');
  });

  it('never returns a role outside the whitelist, for any input', () => {
    const inputs: unknown[] = [
      'developer',
      'DEVELOPER',
      ' caregiver ',
      'patient;--',
      Symbol('patient'),
      () => 'developer',
    ];

    for (const value of inputs) {
      expect(SELF_ASSIGNABLE_ROLES).toContain(normalizeSelfAssignedRole(value));
    }
  });
});

describe('the self-assignable whitelist', () => {
  it('excludes developer', () => {
    expect(SELF_ASSIGNABLE_ROLES).not.toContain('developer');
  });

  it('defaults to the least-privileged role', () => {
    expect(DEFAULT_ROLE).toBe('patient');
    expect(SELF_ASSIGNABLE_ROLES).toContain(DEFAULT_ROLE);
  });
});
