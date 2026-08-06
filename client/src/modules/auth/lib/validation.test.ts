import { hasErrors, isValidEmail, validateLogin, validateRegister } from './validation';

const validRegister = {
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '081-234-5678',
  email: 'somchai@example.com',
  password: 'hunter2hunter2',
  confirmPassword: 'hunter2hunter2',
};

describe('validateLogin', () => {
  it('accepts a formatted phone number', () => {
    // The input shows hyphens; validation has to see through them.
    expect(validateLogin({ phone: '081-234-5678', password: 'x' })).toEqual({});
  });

  it('accepts a 9-digit number without the trunk zero', () => {
    expect(validateLogin({ phone: '81-234-5678', password: 'x' })).toEqual({});
  });

  it('reports both fields when both are empty', () => {
    const errors = validateLogin({ phone: '', password: '' });
    expect(errors.phone).toBeDefined();
    expect(errors.password).toBeDefined();
  });

  it('rejects a phone that is too short', () => {
    expect(validateLogin({ phone: '0812', password: 'x' }).phone).toContain('9-10');
  });

  it('does not check password length on login', () => {
    // The rule may have changed since the account was created; refusing to
    // even attempt the sign-in would lock the user out of their own account.
    expect(validateLogin({ phone: '0812345678', password: 'a' }).password).toBeUndefined();
  });
});

describe('validateRegister', () => {
  it('accepts a complete valid form', () => {
    expect(validateRegister(validRegister)).toEqual({});
  });

  it('requires an email', () => {
    // It was optional before the Better Auth migration; the resolver now
    // rejects a registration without one.
    const errors = validateRegister({ ...validRegister, email: '' });
    expect(errors.email).toBe('กรุณากรอกอีเมล');
  });

  it('rejects a malformed email', () => {
    expect(validateRegister({ ...validRegister, email: 'somchai@' }).email).toBeDefined();
    expect(validateRegister({ ...validRegister, email: 'somchai' }).email).toBeDefined();
  });

  it('enforces the minimum password length', () => {
    const errors = validateRegister({
      ...validRegister,
      password: 'short',
      confirmPassword: 'short',
    });
    expect(errors.password).toContain('8');
  });

  it('catches a mismatched confirmation', () => {
    const errors = validateRegister({ ...validRegister, confirmPassword: 'somethingelse' });
    expect(errors.confirmPassword).toBe('รหัสผ่านไม่ตรงกัน');
    expect(errors.password).toBeUndefined();
  });

  it('treats whitespace-only names as missing', () => {
    const errors = validateRegister({ ...validRegister, firstname: '   ' });
    expect(errors.firstname).toBeDefined();
  });

  it('reports every problem at once rather than one at a time', () => {
    // Revealing errors one per submit is the pattern that makes a long form
    // feel like it is fighting the user.
    const errors = validateRegister({
      firstname: '',
      lastname: '',
      phone: '',
      email: '',
      password: '',
      confirmPassword: '',
    });
    expect(Object.keys(errors)).toHaveLength(6);
  });
});

describe('isValidEmail', () => {
  it('accepts addresses a strict regex would wrongly reject', () => {
    // A false negative here means a user with a legal address cannot
    // register at all, which is worse than passing one to the server.
    expect(isValidEmail('user+tag@example.co.th')).toBe(true);
    expect(isValidEmail('first.last@sub.domain.example')).toBe(true);
  });

  it('rejects the obviously broken shapes', () => {
    expect(isValidEmail('no-at-sign')).toBe(false);
    expect(isValidEmail('two@@example.com')).toBe(false);
    expect(isValidEmail('spaces in@example.com')).toBe(false);
    expect(isValidEmail('no@tld')).toBe(false);
  });
});

describe('hasErrors', () => {
  it('distinguishes an empty result from a populated one', () => {
    expect(hasErrors({})).toBe(false);
    expect(hasErrors({ phone: 'x' })).toBe(true);
  });
});
