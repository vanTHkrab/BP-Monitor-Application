/**
 * The diff is the security control on this path, so it is tested as one.
 *
 * Two properties matter more than any individual case:
 *
 *   1. **The patch can only ever contain the five health fields.** The
 *      gateway keeps `email` and `phone` out by giving `updatePatientHealth`
 *      its own input type; this is the client half, and a test that only
 *      checked "the right values were sent" would pass while an extra key
 *      rode along.
 *   2. **An untouched field is absent, not null.** `gender` and
 *      `congenitalDisease` cannot be read by a caregiver, so "send the whole
 *      form" would erase two columns nobody was shown. Absent means "leave
 *      alone" on the gateway; `null` means "clear it". The distinction is the
 *      reason the form is safe to submit at all.
 */
import {
  changedHealthFields,
  hasHealthChanges,
  healthFormFromPatient,
  patientHasHealthRecord,
  validateHealthForm,
  type HealthForm,
} from './health-form';
import type { PatientHealthProfile, PatientSummary } from '../types';

const patient = (over: Partial<PatientSummary> = {}): PatientSummary => ({
  id: 'p1',
  firstname: 'สมชาย',
  lastname: 'ใจดี',
  phone: '0812345678',
  permission: 'full',
  dob: new Date(1950, 2, 1),
  weight: 60,
  height: 165,
  ...over,
});

describe('healthFormFromPatient', () => {
  it('seeds only what a caregiver can actually read', () => {
    const form = healthFormFromPatient(patient());

    expect(form).toEqual({
      dob: new Date(1950, 2, 1),
      weight: '60',
      height: '165',
      // Blank on purpose, but no longer because the data is unreachable:
      // `GQL_MY_PATIENTS` selects `gender` and `congenitalDisease` now
      // (`services/operations.ts`). This fixture models a patient whose
      // health row the migration could not backfill — the caregiver has to
      // supply the whole block before anything saves.
      gender: null,
      congenital: null,
      congenitalDisease: '',
    });
  });

  // The mutation answers with all five columns, which is the only way these
  // two ever become readable. A second edit in the same session should show
  // what the first one wrote.
  it('prefers what a previous save returned', () => {
    const known: PatientHealthProfile = {
      patientId: 'p1',
      gender: 'male',
      congenitalDisease: 'เบาหวาน',
      weight: 72,
    };

    const form = healthFormFromPatient(patient(), known);

    expect(form.gender).toBe('male');
    expect(form.congenital).toBe('has');
    expect(form.congenitalDisease).toBe('เบาหวาน');
    expect(form.weight).toBe('72');
    // Not in `known`, so the cached patient row still supplies it.
    expect(form.height).toBe('165');
  });

  it('leaves every field blank for a patient with nothing set', () => {
    const form = healthFormFromPatient(
      patient({ dob: undefined, weight: undefined, height: undefined }),
    );

    expect(form).toEqual({
      dob: null,
      gender: null,
      weight: '',
      height: '',
      congenital: null,
      congenitalDisease: '',
    });
  });

  /*
   * `'ไม่มี'` on the wire is the gateway rendering a NULL column, so it is an
   * *answer*, not typing. Seeding it into the text box would make the
   * caregiver look like they had typed the word — and re-saving would then
   * store it verbatim, which the column can never be untangled from again.
   */
  it('seeds a rendered "ไม่มี" as the answer, not as typed text', () => {
    const form = healthFormFromPatient(patient({ congenitalDisease: 'ไม่มี' }));

    expect(form.congenital).toBe('none');
    expect(form.congenitalDisease).toBe('');
  });
});

describe('patientHasHealthRecord', () => {
  it('is true only when the whole block is there', () => {
    expect(patientHasHealthRecord(patient({ gender: 'male' }))).toBe(true);
    // `gender` missing — the row cannot exist without it, so this patient has
    // no `user_informations` row at all.
    expect(patientHasHealthRecord(patient())).toBe(false);
  });

  it('reads what the last save returned over the cached list row', () => {
    const known: PatientHealthProfile = { patientId: 'p1', gender: 'female' };

    expect(patientHasHealthRecord(patient(), known)).toBe(true);
  });
});

describe('changedHealthFields', () => {
  const baseline = healthFormFromPatient(patient());

  it('sends nothing when the form was not touched', () => {
    expect(changedHealthFields(baseline, baseline)).toEqual({});
    expect(hasHealthChanges(changedHealthFields(baseline, baseline))).toBe(false);
  });

  /*
   * The load-bearing case. A caregiver edits the weight; `gender` and
   * `congenitalDisease` are blank because they could not be read — and blank
   * must not travel as `null`, which the gateway reads as "clear this column".
   */
  it('omits the two fields a caregiver cannot see when they were left alone', () => {
    const form: HealthForm = { ...baseline, weight: '80' };

    const patch = changedHealthFields(form, baseline);

    expect(patch).toEqual({ weight: 80 });
    expect('gender' in patch).toBe(false);
    expect('congenitalDisease' in patch).toBe(false);
  });

  it('sends the five fields and nothing else when all five change', () => {
    const form: HealthForm = {
      dob: new Date(1951, 5, 20),
      gender: 'female',
      weight: '80',
      height: '170',
      congenital: 'has',
      congenitalDisease: 'ความดันโลหิตสูง',
    };

    const patch = changedHealthFields(form, baseline);

    // Asserted as an exact object, not with `toMatchObject`: the point is
    // that `email`, `phone`, `firstname`, `lastname` and `avatar` are not
    // reachable from this path, and only an exhaustive comparison shows it.
    expect(patch).toEqual({
      dob: '1951-06-20',
      gender: 'female',
      weight: 80,
      height: 170,
      congenitalDisease: 'ความดันโลหิตสูง',
    });
    expect(Object.keys(patch).sort()).toEqual([
      'congenitalDisease',
      'dob',
      'gender',
      'height',
      'weight',
    ]);
  });

  // `YYYY-MM-DD`, not a full ISO instant: `toISOString()` on the picker's
  // local midnight stores the previous day in negative-offset timezones, and
  // the audit trail would then show a birthday nobody chose.
  it('sends a birthday as a calendar day', () => {
    const form: HealthForm = { ...baseline, dob: new Date(1949, 0, 5) };

    expect(changedHealthFields(form, baseline).dob).toBe('1949-01-05');
  });

  it('clears a field the caregiver emptied, with null rather than undefined', () => {
    const form: HealthForm = { ...baseline, weight: '', dob: null };

    const patch = changedHealthFields(form, baseline);

    expect(patch.weight).toBeNull();
    expect(patch.dob).toBeNull();
    // `undefined` would not survive JSON serialisation and would arrive as an
    // absent key — "leave alone", the opposite of clearing.
    expect('weight' in patch).toBe(true);
    expect('dob' in patch).toBe(true);
  });

  it('does not re-send a number the caregiver retyped in another form', () => {
    const form: HealthForm = { ...baseline, weight: '60.0' };

    expect(changedHealthFields(form, baseline)).toEqual({});
  });

  /*
   * The round trip has to be stable. The gateway sends `'ไม่มี'` for a NULL
   * column and the form holds that as `congenital: 'none'` with an empty text
   * box; comparing the text boxes alone would report a change on every save
   * for every patient who answered "ไม่มี" — a write, and a row in their
   * audit trail, for an edit nobody made.
   */
  it('does not re-send an unchanged "ไม่มี" answer', () => {
    const seeded = healthFormFromPatient(patient({ congenitalDisease: 'ไม่มี' }));

    expect(changedHealthFields(seeded, seeded)).toEqual({});
  });

  // NULL is what the column stores for "no condition"; the gateway has no
  // inverse mapping, so sending the string would store the word instead.
  it('sends null when the answer changes to "ไม่มี"', () => {
    const seeded = healthFormFromPatient(patient({ congenitalDisease: 'เบาหวาน' }));

    expect(
      changedHealthFields({ ...seeded, congenital: 'none', congenitalDisease: '' }, seeded),
    ).toEqual({ congenitalDisease: null });
  });

  it('trims a congenital disease and treats whitespace as no change', () => {
    const known: PatientHealthProfile = { patientId: 'p1', congenitalDisease: 'เบาหวาน' };
    const seeded = healthFormFromPatient(patient(), known);

    expect(changedHealthFields({ ...seeded, congenitalDisease: '  เบาหวาน  ' }, seeded)).toEqual(
      {},
    );
    expect(
      changedHealthFields({ ...seeded, congenitalDisease: ' เบาหวาน ความดัน ' }, seeded),
    ).toEqual({ congenitalDisease: 'เบาหวาน ความดัน' });
  });
});

describe('validateHealthForm', () => {
  const empty: HealthForm = {
    dob: null,
    gender: null,
    weight: '',
    height: '',
    congenital: null,
    congenitalDisease: '',
  };

  const complete: HealthForm = {
    dob: new Date(1950, 2, 1),
    gender: 'male',
    weight: '60',
    height: '165',
    congenital: 'none',
    congenitalDisease: '',
  };

  /*
   * A patient with no `user_informations` row: the block may be left entirely
   * alone, because the patch then carries no health key and the gateway never
   * looks at it.
   */
  it('accepts an entirely empty form when the patient has no health row', () => {
    expect(validateHealthForm(empty)).toEqual({});
  });

  /*
   * ...but not half of it. A partial patch cannot create the row, and the
   * gateway answers that with a 400 rather than a half-built row.
   */
  it('requires the rest of the block once any of it is filled in', () => {
    const errors = validateHealthForm({ ...empty, weight: '60' });

    expect(errors.dob).toBe('กรุณาเลือกวันเกิด');
    expect(errors.gender).toBe('กรุณาเลือกเพศ');
    expect(errors.height).toBe('กรุณากรอกส่วนสูง');
    expect(errors.congenital).toBe('กรุณาระบุว่ามีโรคประจำตัวหรือไม่');
  });

  /*
   * The break this change exists for. The four are NOT NULL on
   * `user_informations`, and the gateway refuses a clear rather than dropping
   * it — dropping it would answer 200 with the old value still in place and
   * nothing in the audit trail, on a screen whose whole premise is the audit
   * trail.
   */
  it('refuses to clear a required field a patient already has', () => {
    const errors = validateHealthForm({ ...complete, weight: '' }, new Date(), {
      recorded: true,
    });

    expect(errors.weight).toBe('ไม่สามารถลบข้อมูลน้ำหนักได้ กรุณาระบุค่าใหม่แทน');
  });

  it('accepts a complete block unchanged', () => {
    expect(validateHealthForm(complete, new Date(), { recorded: true })).toEqual({});
  });

  it('rejects "มี" with nothing typed', () => {
    const errors = validateHealthForm(
      { ...complete, congenital: 'has', congenitalDisease: '' },
      new Date(),
      { recorded: true },
    );

    expect(errors.congenitalDisease).toBe('กรุณาระบุโรคประจำตัว');
  });

  it('rejects a slipped decimal point', () => {
    expect(validateHealthForm({ ...empty, height: '1750' }).height).toBeTruthy();
    expect(validateHealthForm({ ...empty, weight: '600' }).weight).toBeTruthy();
  });

  it('rejects a birthday in the future', () => {
    const now = new Date(2026, 7, 6);
    const errors = validateHealthForm({ ...empty, dob: new Date(2027, 0, 1) }, now);

    expect(errors.dob).toBeTruthy();
  });
});
