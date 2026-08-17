import {
  NAME_MAX,
  PASSWORD_MAX,
  hasErrors,
  isValidEmail,
  isValidPhone,
  validateLogin,
  validateRegister,
} from './validation';

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
    expect(validateLogin({ phone: '0812', password: 'x' }).phone).toContain('9-15');
  });

  /*
   * The rule was `{9,10}` while the gateway's `PHONE_REGEX` is `{9,15}`, so an
   * account holding an 11-digit number could not be signed in to from the app
   * at all — the request never went out. Sign-in is where that is
   * unrecoverable: the user cannot reach the profile screen to shorten it.
   *
   * NOTE: this asserts the *validator's* accept-set, which is now the
   * gateway's. It does not assert that the login screen can produce an
   * 11-digit value — `utils/phone-format`'s `formatThaiPhone` still truncates
   * every input to 10 digits before this ever sees it. That cap is a separate
   * fix; see the report accompanying this change.
   */
  it('accepts the international lengths the gateway accepts', () => {
    expect(validateLogin({ phone: '66812345678', password: 'x' }).phone).toBeUndefined();
    expect(validateLogin({ phone: '123456789012345', password: 'x' }).phone).toBeUndefined();
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

/*
 * The register form's optional health block had no validation at all: a weight
 * of 9999 went out, the gateway refused it with an English class-validator
 * message, and the whole registration failed with nothing pointing at the
 * field that caused it.
 *
 * The bounds are `@/lib/health-validation`'s, shared with the profile and
 * caregiver forms. The failure being guarded against is not "an out-of-range
 * value reaches the server" — it is a value the sign-up form accepts and the
 * user's own profile screen then refuses to re-save, leaving them stuck with a
 * number they cannot correct.
 */
describe('validateRegister — the optional health block', () => {
  it('accepts the whole block left empty, because all of it is optional', () => {
    const errors = validateRegister({
      ...validRegister,
      dob: null,
      gender: null,
      weight: '',
      height: '',
      congenitalDisease: '',
    });

    expect(errors).toEqual({});
  });

  it('accepts a plausible set of values', () => {
    const errors = validateRegister({
      ...validRegister,
      dob: new Date('1960-05-20'),
      gender: 'male',
      weight: '70',
      height: '170',
      congenitalDisease: 'เบาหวาน',
    });

    expect(errors).toEqual({});
  });

  // The slipped decimal point the bounds exist for.
  it('rejects a height typed in millimetres', () => {
    expect(validateRegister({ ...validRegister, height: '1700' }).height).toBeDefined();
  });

  /*
   * The bounds are the gateway's own `@Min` / `@Max` exactly (1-500 kg,
   * 30-280 cm on `RegisterInput`), not a narrower client-side guess — an
   * earlier version of this file kept a tighter range here and refused "10"
   * as a weight, on the theory that profile's plausibility judgement should
   * win. That was reversed: it broke this file's own rule that nothing may be
   * stricter than the gateway on a column the server would otherwise accept,
   * the same failure mode the old `{9,10}` phone regex had. So the boundary
   * values that matter now are the gateway's, both ends.
   */
  it('accepts the gateway boundary values exactly', () => {
    const low = validateRegister({ ...validRegister, weight: '1', height: '30' });
    const high = validateRegister({ ...validRegister, weight: '500', height: '280' });

    expect(low.weight).toBeUndefined();
    expect(low.height).toBeUndefined();
    expect(high.weight).toBeUndefined();
    expect(high.height).toBeUndefined();
  });

  it('rejects one unit past either boundary', () => {
    const tooLight = validateRegister({ ...validRegister, weight: '0.9' });
    const tooHeavy = validateRegister({ ...validRegister, weight: '501' });
    const tooShort = validateRegister({ ...validRegister, height: '29' });
    const tooTall = validateRegister({ ...validRegister, height: '281' });

    expect(tooLight.weight).toBeDefined();
    expect(tooHeavy.weight).toBeDefined();
    expect(tooShort.height).toBeDefined();
    expect(tooTall.height).toBeDefined();
  });

  it('rejects a weight over the gateway maximum', () => {
    expect(validateRegister({ ...validRegister, weight: '9999' }).weight).toBeDefined();
  });

  it('rejects non-numeric measurements', () => {
    expect(validateRegister({ ...validRegister, weight: 'เจ็ดสิบ' }).weight).toBeDefined();
  });

  it('rejects a future date of birth', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const tomorrow = new Date(now.getTime() + 86_400_000);

    expect(validateRegister({ ...validRegister, dob: tomorrow }, now).dob).toBeDefined();
  });

  it('rejects an implausible birth year the profile screen already caught', () => {
    const now = new Date('2026-08-01T00:00:00.000Z');
    const tooOld = new Date(now);
    tooOld.setFullYear(tooOld.getFullYear() - 121);

    expect(validateRegister({ ...validRegister, dob: tooOld }, now).dob).toBeDefined();
  });

  it('rejects an over-long congenital disease note', () => {
    const errors = validateRegister({
      ...validRegister,
      congenitalDisease: 'ก'.repeat(501),
    });

    expect(errors.congenitalDisease).toBeDefined();
  });

  it('routes each failure to its own field rather than one shared message', () => {
    // The screen renders `errorFor(field)` under each input; a single merged
    // message would have nowhere to go and would land in the banner.
    const errors = validateRegister({
      ...validRegister,
      weight: '9999',
      height: '1700',
      congenitalDisease: 'ก'.repeat(501),
    });

    expect(Object.keys(errors).sort()).toEqual(['congenitalDisease', 'height', 'weight']);
  });
});

/*
 * The other half of the same rule: the client must not be *looser* in a way
 * that guarantees a server rejection. Both of these are refused by
 * `RegisterInput` with an English class-validator message the user cannot
 * attribute to a field, so they are caught here where the field is known.
 */
describe('validateRegister — the bounds the gateway enforces', () => {
  it('rejects a password past bcrypt input limit', () => {
    const tooLong = 'a'.repeat(PASSWORD_MAX + 1);
    const errors = validateRegister({
      ...validRegister,
      password: tooLong,
      confirmPassword: tooLong,
    });

    expect(errors.password).toContain(String(PASSWORD_MAX));
  });

  it('accepts a password of exactly the maximum', () => {
    const exact = 'a'.repeat(PASSWORD_MAX);
    const errors = validateRegister({
      ...validRegister,
      password: exact,
      confirmPassword: exact,
    });

    expect(errors.password).toBeUndefined();
  });

  it('rejects a name past the column length', () => {
    const errors = validateRegister({ ...validRegister, firstname: 'ก'.repeat(NAME_MAX + 1) });

    expect(errors.firstname).toBeDefined();
  });

  it('accepts a name of exactly the maximum', () => {
    const errors = validateRegister({ ...validRegister, lastname: 'ก'.repeat(NAME_MAX) });

    expect(errors.lastname).toBeUndefined();
  });
});

describe('isValidPhone', () => {
  /*
   * The accept-set is the gateway's `PHONE_REGEX` exactly. Being *stricter*
   * than the server here is what made a legitimate account unreachable: it is
   * checked on sign-up, on sign-in, and on the profile save, so an 11-digit
   * number could not be registered, used, or corrected.
   */
  it('accepts every length the gateway accepts', () => {
    expect(isValidPhone('081234567')).toBe(true); // 9, the floor
    expect(isValidPhone('0812345678')).toBe(true); // 10, the common Thai case
    expect(isValidPhone('66812345678')).toBe(true); // 11, previously refused
    expect(isValidPhone('123456789012345')).toBe(true); // 15, the ceiling
  });

  it('still rejects what the gateway rejects', () => {
    expect(isValidPhone('12345678')).toBe(false); // 8, under the floor
    expect(isValidPhone('1234567890123456')).toBe(false); // 16, over the ceiling
    expect(isValidPhone('')).toBe(false);
  });

  // The field hands this digits only; a formatted value must never reach it.
  it('rejects anything that is not purely digits', () => {
    expect(isValidPhone('081-234-5678')).toBe(false);
    expect(isValidPhone('+66812345678')).toBe(false);
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
