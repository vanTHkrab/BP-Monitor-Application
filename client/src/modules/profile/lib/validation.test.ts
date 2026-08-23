import { MAX_AGE_YEARS, validateProfile, type ProfileBaseline } from './validation';
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
  congenital: 'none',
  congenitalDisease: '',
  ...over,
});

/**
 * A record that has completed the health step. Two rules read it, and both
 * are the same idea — you may not clear what you have, and you are not
 * blocked by what you never had — so almost every test below has to say which
 * of the two records it is talking about. `undefined` is the other one.
 */
const recorded = (over: Partial<ProfileBaseline> = {}): ProfileBaseline => ({
  lastname: 'ใจดี',
  dob: new Date('1960-05-20'),
  gender: 'male',
  weight: 70,
  height: 170,
  ...over,
});

describe('validateProfile', () => {
  it('accepts a filled-in form', () => {
    expect(validateProfile(form(), NOW)).toEqual({});
  });

  /*
   * A record with no `user_informations` row may leave the whole block alone
   * — the patch then carries no health key and the gateway never looks at it.
   * A Google sign-up starts here, and so does any account the migration could
   * not backfill.
   */
  it('accepts the whole health block left empty when the record has none', () => {
    const errors = validateProfile(
      form({
        dob: null,
        gender: null,
        weight: '',
        height: '',
        congenital: null,
        congenitalDisease: '',
      }),
      NOW,
    );

    expect(errors).toEqual({});
  });

  /*
   * ...but not half of it. A partial patch cannot bring the row into
   * existence, and the gateway answers it with a 400 rather than a half-built
   * row, so the form has to ask for the rest before it sends anything.
   */
  it('requires the rest of the block once any of it is filled in', () => {
    const errors = validateProfile(
      form({
        dob: null,
        gender: null,
        weight: '70',
        height: '',
        congenital: null,
        congenitalDisease: '',
      }),
      NOW,
    );

    expect(errors.dob).toBe('กรุณาเลือกวันเกิด');
    expect(errors.gender).toBe('กรุณาเลือกเพศ');
    expect(errors.height).toBe('กรุณากรอกส่วนสูง');
    expect(errors.congenital).toBe('กรุณาระบุว่ามีโรคประจำตัวหรือไม่');
    expect(errors.weight).toBeUndefined();
  });

  /*
   * The break this change exists for: `dob`, `gender`, `weight` and `height`
   * are NOT NULL on `user_informations`, so the gateway answers a clear with
   * a 400 on purpose — dropping it would return 200 with the old value still
   * in place. The form must not offer what the server will refuse.
   */
  it('refuses to clear a required field a record already has', () => {
    const errors = validateProfile(
      form({ weight: '', height: '   ' }),
      NOW,
      recorded(),
    );

    expect(errors.weight).toBe('ไม่สามารถลบข้อมูลน้ำหนักได้ กรุณาระบุค่าใหม่แทน');
    expect(errors.height).toBe('ไม่สามารถลบข้อมูลส่วนสูงได้ กรุณาระบุค่าใหม่แทน');
  });

  it('requires the first name always', () => {
    expect(validateProfile(form({ firstname: '  ' }), NOW).firstname).toBeDefined();
  });

  it('refuses to clear a surname the record has', () => {
    expect(validateProfile(form({ lastname: '' }), NOW, recorded()).lastname).toBeDefined();
  });

  /*
   * A Google account whose name is one word gets `lastname: ''` from the
   * gateway, deliberately — inventing a surname would be a sentinel nobody
   * could tell from a real one. Requiring it unconditionally would open that
   * user's edit form already in an error state, unable to save anything else
   * until they made one up.
   */
  it('does not demand a surname the record never had', () => {
    const errors = validateProfile(form({ lastname: '' }), NOW, recorded({ lastname: '' }));

    expect(errors.lastname).toBeUndefined();
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
    expect(
      validateProfile(
        form({ congenital: 'has', congenitalDisease: 'ก'.repeat(501) }),
        NOW,
      ).congenitalDisease,
    ).toBeDefined();
  });

  it('rejects "มี" with nothing typed', () => {
    expect(
      validateProfile(form({ congenital: 'has', congenitalDisease: '' }), NOW)
        .congenitalDisease,
    ).toBe('กรุณาระบุโรคประจำตัว');
  });
});
