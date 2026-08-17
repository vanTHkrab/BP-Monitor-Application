/**
 * The bounds three forms share.
 *
 * These were `modules/profile`'s alone, which is what made them a bug: the
 * sign-up form did not run them, so a 10 kg weight registered successfully and
 * then could never be re-saved from the patient's own profile screen. The
 * tests below pin the *contract* — what is accepted, what is refused, and that
 * empty is always fine — so the three call sites cannot drift apart again by
 * one of them quietly reimplementing a check.
 */
import {
  CONGENITAL_DISEASE_MAX,
  HEIGHT_RANGE_CM,
  MAX_AGE_YEARS,
  WEIGHT_RANGE_KG,
  validateCongenitalDisease,
  validateDob,
  validateMeasurement,
} from './health-validation';

const NOW = new Date('2026-08-01T00:00:00.000Z');

describe('validateMeasurement', () => {
  // Every field using this is optional, so blank is not a failure. Getting
  // this backwards makes the whole health block mandatory at sign-up.
  it.each(['', '   '])('treats %p as nothing to check', (raw) => {
    expect(validateMeasurement(raw, WEIGHT_RANGE_KG, 'กก.')).toBeNull();
  });

  it('accepts a value inside the range', () => {
    expect(validateMeasurement('70', WEIGHT_RANGE_KG, 'กก.')).toBeNull();
    expect(validateMeasurement('170', HEIGHT_RANGE_CM, 'ซม.')).toBeNull();
  });

  it('accepts both ends of the range inclusively', () => {
    expect(validateMeasurement(String(WEIGHT_RANGE_KG.min), WEIGHT_RANGE_KG, 'กก.')).toBeNull();
    expect(validateMeasurement(String(WEIGHT_RANGE_KG.max), WEIGHT_RANGE_KG, 'กก.')).toBeNull();
  });

  it('rejects a value just outside either end', () => {
    expect(validateMeasurement(String(WEIGHT_RANGE_KG.min - 1), WEIGHT_RANGE_KG, 'กก.')).not.toBeNull();
    expect(validateMeasurement(String(WEIGHT_RANGE_KG.max + 1), WEIGHT_RANGE_KG, 'กก.')).not.toBeNull();
  });

  // The slipped decimal point these bounds exist for.
  it('catches a height typed in millimetres', () => {
    expect(validateMeasurement('1700', HEIGHT_RANGE_CM, 'ซม.')).not.toBeNull();
  });

  it('rejects text that is not a number', () => {
    expect(validateMeasurement('เจ็ดสิบ', WEIGHT_RANGE_KG, 'กก.')).toBe('กรุณากรอกเป็นตัวเลข');
  });

  // The message names the range and the unit, because "invalid" leaves the
  // user guessing which direction they were wrong in. Derived from the range
  // rather than a literal out-of-range number — a literal comfortably outside
  // the old 20-300 bound silently stopped being out-of-range at all once the
  // bound widened to 1-500, which is exactly the kind of test rot a fixed
  // constant invites here.
  it('names the range and unit in the message', () => {
    const overMax = String(WEIGHT_RANGE_KG.max + 1);

    expect(validateMeasurement(overMax, WEIGHT_RANGE_KG, 'กก.')).toBe(
      `กรุณากรอกระหว่าง ${WEIGHT_RANGE_KG.min}-${WEIGHT_RANGE_KG.max} กก.`,
    );
  });
});

describe('validateDob', () => {
  it('treats an unset birthday as nothing to check', () => {
    expect(validateDob(null, NOW)).toBeNull();
  });

  it('accepts a plausible birthday', () => {
    expect(validateDob(new Date('1960-05-20'), NOW)).toBeNull();
  });

  it('rejects a date in the future', () => {
    const tomorrow = new Date(NOW.getTime() + 86_400_000);

    expect(validateDob(tomorrow, NOW)).toBe('วันเกิดต้องไม่เป็นวันในอนาคต');
  });

  it('rejects a birth year nobody alive could have', () => {
    const tooOld = new Date(NOW);
    tooOld.setFullYear(tooOld.getFullYear() - MAX_AGE_YEARS - 1);

    expect(validateDob(tooOld, NOW)).toBe('กรุณาตรวจสอบปีเกิดอีกครั้ง');
  });

  // The boundary is the typo'd year, not a real person's age, so exactly
  // `MAX_AGE_YEARS` has to pass or the oldest plausible user is locked out.
  it('accepts exactly the oldest allowed age', () => {
    const oldest = new Date(NOW);
    oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);

    expect(validateDob(oldest, NOW)).toBeNull();
  });
});

describe('validateCongenitalDisease', () => {
  it('accepts an empty note', () => {
    expect(validateCongenitalDisease('')).toBeNull();
  });

  it('accepts a note at exactly the column limit', () => {
    expect(validateCongenitalDisease('ก'.repeat(CONGENITAL_DISEASE_MAX))).toBeNull();
  });

  it('rejects a note past the column limit', () => {
    expect(validateCongenitalDisease('ก'.repeat(CONGENITAL_DISEASE_MAX + 1))).not.toBeNull();
  });

  /*
   * Trimmed before measuring, so trailing whitespace cannot push a note over a
   * limit the server would have accepted after its own trim — the client
   * refusing what the gateway would store is the failure this whole file is
   * about, in miniature.
   */
  it('measures the trimmed length, not the raw one', () => {
    const padded = `${'ก'.repeat(CONGENITAL_DISEASE_MAX)}     `;

    expect(validateCongenitalDisease(padded)).toBeNull();
  });
});
