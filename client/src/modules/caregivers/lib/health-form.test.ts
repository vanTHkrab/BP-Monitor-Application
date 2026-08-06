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
      // `myPatients` carries neither, and there is no query that returns them
      // to a caregiver. Blank is the honest seed.
      gender: null,
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
      congenitalDisease: '',
    });
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
    congenitalDisease: '',
  };

  it('accepts an entirely empty form — every field is optional', () => {
    expect(validateHealthForm(empty)).toEqual({});
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
