import { MAX_AGE_YEARS, validateProfile } from './validation';
import type { ProfileForm } from '../types';

const NOW = new Date('2026-08-01T00:00:00.000Z');

const form = (over: Partial<ProfileForm> = {}): ProfileForm => ({
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '081-234-5678',
  dob: new Date('1960-05-20'),
  gender: 'male',
  weight: '70',
  height: '170',
  congenitalDisease: '',
  ...over,
});

describe('validateProfile', () => {
  it('accepts a filled-in form', () => {
    expect(validateProfile(form(), NOW)).toEqual({});
  });

  it('accepts every optional field left empty', () => {
    const errors = validateProfile(
      form({ dob: null, gender: null, weight: '', height: '', congenitalDisease: '' }),
      NOW,
    );

    expect(errors).toEqual({});
  });

  it('requires both name fields', () => {
    const errors = validateProfile(form({ firstname: '  ', lastname: '' }), NOW);

    expect(errors.firstname).toBeDefined();
    expect(errors.lastname).toBeDefined();
  });

  it('accepts the phone in the format the field displays it in', () => {
    expect(validateProfile(form({ phone: '081-234-5678' }), NOW).phone).toBeUndefined();
  });

  it('rejects a phone that is too short', () => {
    expect(validateProfile(form({ phone: '0812' }), NOW).phone).toBeDefined();
  });

  /*
   * This screen shares `isValidPhone` with the auth forms deliberately — the
   * two write the same column, and a profile form stricter than the register
   * form makes an account unable to re-save the number it signed up with. The
   * rule was `{9,10}` against a gateway `{9,15}`, so the assertion is that the
   * widening reached here and not just the sign-in path.
   */
  it('accepts the international lengths the gateway accepts', () => {
    expect(validateProfile(form({ phone: '66812345678' }), NOW).phone).toBeUndefined();
    expect(validateProfile(form({ phone: '123456789012345' }), NOW).phone).toBeUndefined();
  });

  it('rejects a future date of birth', () => {
    const tomorrow = new Date(NOW.getTime() + 86_400_000);

    expect(validateProfile(form({ dob: tomorrow }), NOW).dob).toBeDefined();
  });

  it('rejects an implausible birth year', () => {
    const tooOld = new Date(NOW);
    tooOld.setFullYear(tooOld.getFullYear() - MAX_AGE_YEARS - 1);

    expect(validateProfile(form({ dob: tooOld }), NOW).dob).toBeDefined();
  });

  // The slipped decimal point these bounds exist for.
  it('rejects a height typed in millimetres', () => {
    expect(validateProfile(form({ height: '1700' }), NOW).height).toBeDefined();
  });

  it('rejects non-numeric measurements', () => {
    expect(validateProfile(form({ weight: 'เจ็ดสิบ' }), NOW).weight).toBeDefined();
  });

  it('rejects an over-long congenital disease note', () => {
    expect(validateProfile(form({ congenitalDisease: 'ก'.repeat(501) }), NOW)
      .congenitalDisease).toBeDefined();
  });
});
