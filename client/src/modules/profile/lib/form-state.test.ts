import { changedFields, formFromUser, hasChanges } from './form-state';
import type { User } from '@/modules/auth';
import type { ProfileForm } from '../types';

const user = (over: Partial<User> = {}): User => ({
  id: 'u1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  emailVerified: true,
  role: 'patient',
  createdAt: new Date('2026-01-01'),
  weight: 70,
  height: 170,
  gender: 'male',
  // Constructed in local time, not parsed from an ISO string: `sameDay`
  // compares local calendar days (a date picker hands back local midnight),
  // and a UTC-parsed fixture lands on a different local day in any timezone
  // east of Greenwich.
  dob: new Date(1960, 4, 20),
  congenitalDisease: 'เบาหวาน',
  ...over,
});

const formOf = (over: Partial<ProfileForm> = {}): ProfileForm => ({
  ...formFromUser(user()),
  ...over,
});

describe('formFromUser', () => {
  it('renders numbers as strings and missing values as empty', () => {
    const form = formFromUser(user({ weight: undefined, height: 170 }));

    expect(form.weight).toBe('');
    expect(form.height).toBe('170');
  });

  it('survives a null user', () => {
    expect(formFromUser(null)).toEqual({
      firstname: '',
      lastname: '',
      phone: '',
      dob: null,
      gender: null,
      weight: '',
      height: '',
      congenital: null,
      congenitalDisease: '',
    });
  });

  /*
   * `'ไม่มี'` on the wire is the gateway rendering a NULL column — an answer,
   * not typing. Seeding it into the text box would make the user look like
   * they had typed the word, and re-saving would then store it verbatim,
   * which the column can never be untangled from again.
   */
  it('seeds a rendered "ไม่มี" as the answer, not as typed text', () => {
    const form = formFromUser(user({ congenitalDisease: 'ไม่มี' }));

    expect(form.congenital).toBe('none');
    expect(form.congenitalDisease).toBe('');
  });

  it('seeds an unanswered question as null, not as "no"', () => {
    expect(formFromUser(user({ congenitalDisease: undefined })).congenital).toBeNull();
  });
});

describe('changedFields', () => {
  it('sends nothing when the form still matches the user', () => {
    expect(hasChanges(changedFields(formOf(), user()))).toBe(false);
  });

  it('sends only the field that changed', () => {
    expect(changedFields(formOf({ firstname: 'สมหญิง' }), user())).toEqual({
      firstname: 'สมหญิง',
    });
  });

  it('ignores a reformatted phone number that is the same digits', () => {
    expect(hasChanges(changedFields(formOf({ phone: '081-234-5678' }), user()))).toBe(false);
  });

  it('ignores a retyped number that parses to the same value', () => {
    expect(hasChanges(changedFields(formOf({ weight: '70.0' }), user()))).toBe(false);
  });

  // The regression this file exists for: `undefined` is dropped by JSON
  // serialisation, so it would reach the gateway as an absent key — meaning
  // "leave the column alone", the opposite of clearing it.
  it('sends null, not undefined, when an optional field is cleared', () => {
    const patch = changedFields(
      formOf({ weight: '', height: '', congenitalDisease: '', dob: null, gender: null }),
      user(),
    );

    expect(patch).toEqual({
      weight: null,
      height: null,
      congenitalDisease: null,
      dob: null,
      gender: null,
    });
    expect(Object.values(patch).every((value) => value !== undefined)).toBe(true);
  });

  /*
   * The round trip has to be stable: the server sends 'ไม่มี', the form holds
   * it as `congenital: 'none'` with an empty text box, and comparing the text
   * box alone would report a change on every save for every user who answered
   * "ไม่มี" — a write, and an audit-trail row, for an edit nobody made.
   */
  it('does not re-send an unchanged "ไม่มี" answer', () => {
    const seeded = formFromUser(user({ congenitalDisease: 'ไม่มี' }));

    expect(hasChanges(changedFields(seeded, user({ congenitalDisease: 'ไม่มี' })))).toBe(false);
  });

  // NULL is what the column stores for "no condition", and the gateway has no
  // inverse mapping — sending the string would store the word instead.
  it('sends null when the answer changes to "ไม่มี"', () => {
    expect(
      changedFields(formOf({ congenital: 'none', congenitalDisease: '' }), user()),
    ).toEqual({ congenitalDisease: null });
  });

  // Unanswered means the key must not be sent at all: an absent key leaves
  // the column alone, which is the only honest thing to say about a question
  // nobody answered.
  it('sends no congenital key while the question is unanswered', () => {
    const patch = changedFields(
      formOf({ congenital: null, congenitalDisease: '' }),
      user({ congenitalDisease: undefined }),
    );

    expect('congenitalDisease' in patch).toBe(false);
  });

  it('sends a changed birthday as a calendar day, not an instant', () => {
    expect(changedFields(formOf({ dob: new Date(1961, 0, 2) }), user())).toEqual({
      dob: '1961-01-02',
    });
  });

  it('treats a same-day date as unchanged despite a different time', () => {
    const sameDayLater = new Date(1960, 4, 20, 23, 30);

    expect(hasChanges(changedFields(formOf({ dob: sameDayLater }), user()))).toBe(false);
  });

  it('trims text before comparing and before sending', () => {
    expect(hasChanges(changedFields(formOf({ firstname: '  สมชาย  ' }), user()))).toBe(false);
    expect(changedFields(formOf({ lastname: '  ใจงาม  ' }), user())).toEqual({
      lastname: 'ใจงาม',
    });
  });
});
