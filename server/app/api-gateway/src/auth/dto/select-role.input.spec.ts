import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { SELF_ASSIGNABLE_ROLES } from '../types/auth.types';
import { RegisterInput } from './register.input';
import { SelectRoleInput } from './select-role.input';
import { UserRoleInput } from './user-role.enum';

const validate = (cls: new () => object, payload: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('SelectRoleInput', () => {
  it('accepts the two self-assignable roles', () => {
    expect(validate(SelectRoleInput, { role: 'patient' })).toHaveLength(0);
    expect(validate(SelectRoleInput, { role: 'caregiver' })).toHaveLength(0);
  });

  it('rejects developer', () => {
    // Not the real defence — `normalizeSelfAssignedRole` in the service is.
    // This turns it into a clear 400 rather than a silent downgrade.
    expect(validate(SelectRoleInput, { role: 'developer' })).not.toHaveLength(
      0,
    );
  });

  it('rejects an unknown or empty role', () => {
    expect(validate(SelectRoleInput, { role: 'admin' })).not.toHaveLength(0);
    expect(validate(SelectRoleInput, { role: '' })).not.toHaveLength(0);
  });

  it('requires the field — there is no implicit default here', () => {
    // The default belongs to registration. Reaching this mutation means the
    // user is being asked to choose, so an empty call is a client bug.
    expect(validate(SelectRoleInput, {})).not.toHaveLength(0);
  });
});

describe('RegisterInput', () => {
  it('does not accept a role', () => {
    // Registration always produces a patient with `roleSelectedAt` null; the
    // onboarding step is the single place a role is granted. Accepting one
    // here would be a second grant point to keep in step.
    const errors = validate(RegisterInput, {
      firstname: 'สมชาย',
      lastname: 'ใจดี',
      phone: '0812345678',
      password: 'hunter2hunter2',
      email: 'somchai@example.com',
      role: 'caregiver',
    });

    expect(errors.some((error) => error.property === 'role')).toBe(true);
  });
});

describe('UserRoleInput', () => {
  it('matches the whitelist the service enforces', () => {
    // Two sources of truth that must agree: the GraphQL enum shapes what a
    // client can send, `SELF_ASSIGNABLE_ROLES` decides what gets written. A
    // role added to one and not the other is either an unreachable option or
    // a silently downgraded one.
    expect(Object.values(UserRoleInput).sort()).toEqual(
      [...SELF_ASSIGNABLE_ROLES].sort(),
    );
  });
});
