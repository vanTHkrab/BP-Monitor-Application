/// <reference types="jest" />
/**
 * The classification ladder.
 *
 * Two things are asserted here that a hand-check would not catch.
 *
 * **Every boundary, from both sides.** The bounds are inclusive on the high
 * bands (`>=`) and exclusive on `low` (`<`), so 90/60 is normal and 89/60 is
 * not. An off-by-one in either direction moves a real patient between two
 * bands and is invisible in any test that only uses round numbers like
 * 120/80 and 200/130.
 *
 * **The branch order.** `low` is evaluated before the high bands, so a
 * crossed pair — a low systolic with a high diastolic — reports `low`. That
 * is deliberate: it reads as a measurement to repeat rather than as
 * hypertension. Reordering the branches passes every uncrossed test and
 * changes the answer only for the readings nobody thinks to write down, which
 * is why the crossed cases are pinned explicitly.
 */
import { BpStatus } from '../prisma/generated/enums';
import { BP_THRESHOLDS, classifyReading } from './bp-status';

describe('classifyReading — the bands', () => {
  it.each([
    [120, 80, BpStatus.normal],
    [110, 70, BpStatus.normal],
    [135, 82, BpStatus.elevated],
    [145, 92, BpStatus.high],
    [190, 125, BpStatus.critical],
    [85, 55, BpStatus.low],
  ])('%i/%i is %s', (systolic, diastolic, expected) => {
    expect(classifyReading(systolic, diastolic)).toBe(expected);
  });
});

describe('classifyReading — the boundaries, from both sides', () => {
  it.each([
    // `low` is exclusive: the bound itself is not low.
    [90, 60, BpStatus.normal],
    [89, 60, BpStatus.low],
    [90, 59, BpStatus.low],

    // The high bands are inclusive: the bound itself is already in the band.
    [129, 84, BpStatus.normal],
    [130, 84, BpStatus.elevated],
    [129, 85, BpStatus.elevated],

    [139, 89, BpStatus.elevated],
    [140, 89, BpStatus.high],
    [139, 90, BpStatus.high],

    [179, 119, BpStatus.high],
    [180, 119, BpStatus.critical],
    [179, 120, BpStatus.critical],
  ])('%i/%i is %s', (systolic, diastolic, expected) => {
    expect(classifyReading(systolic, diastolic)).toBe(expected);
  });
});

describe('classifyReading — either number is enough on its own', () => {
  /*
   * An isolated diastolic of 95 is hypertension whatever the systolic says.
   * Taking the milder of the two would tell that patient they are fine.
   */
  it('reports high on the diastolic alone', () => {
    expect(classifyReading(118, 95)).toBe(BpStatus.high);
  });

  it('reports high on the systolic alone', () => {
    expect(classifyReading(150, 78)).toBe(BpStatus.high);
  });

  it('reports critical on the diastolic alone', () => {
    expect(classifyReading(150, 122)).toBe(BpStatus.critical);
  });
});

describe('classifyReading — crossed readings pin the branch order', () => {
  /*
   * The case the ordering exists for. 85/95 is a low systolic beside a
   * hypertensive diastolic: far more likely a cuff that slipped than a real
   * simultaneous state. Reporting `low` asks the patient to measure again;
   * reporting `high` files a probably-wrong number as a diagnosis.
   *
   * Move `low` below the high bands and this returns `high` instead, with
   * every other test in this file still green.
   */
  it('calls a low systolic with a hypertensive diastolic low', () => {
    expect(classifyReading(85, 95)).toBe(BpStatus.low);
  });

  it('calls a low diastolic with a critical systolic low', () => {
    expect(classifyReading(185, 55)).toBe(BpStatus.low);
  });
});

describe('BP_THRESHOLDS', () => {
  /*
   * The ladder reads the table, so a bound edited in one place and not the
   * other would be caught here rather than by a patient. Asserted as values
   * because the point is that these specific numbers are the contract shared
   * with `client/src/modules/readings/lib/status.ts`.
   */
  it('holds the bounds the client mirrors', () => {
    expect(BP_THRESHOLDS).toEqual({
      low: { systolic: 90, diastolic: 60 },
      elevated: { systolic: 130, diastolic: 85 },
      high: { systolic: 140, diastolic: 90 },
      critical: { systolic: 180, diastolic: 120 },
    });
  });
});
