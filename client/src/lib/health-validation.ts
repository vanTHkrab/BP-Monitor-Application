/**
 * Plausibility bounds for the health columns, and the validators that read them.
 *
 * Neutral by design. Three modules write these same columns — `modules/auth`
 * at sign-up, `modules/profile` from the patient's own edit form, and
 * `modules/caregivers` when someone edits on the patient's behalf — and a
 * bound only one of them enforces produces a value that form then refuses to
 * re-save. A 10 kg weight accepted at sign-up and rejected by the profile
 * screen leaves the user stuck with a number they cannot correct.
 *
 * It lives outside all three rather than inside one of them because
 * `modules/profile/lib/validation.ts` already imports `isValidPhone` from
 * `modules/auth/lib/validation.ts`. Having auth import the measurement rules
 * back from profile would close a cycle between two modules — fragile under
 * Jest even where ESM tolerates it. This file imports nothing, so nothing can
 * cycle through it.
 *
 * The bounds are plausibility checks, not medical ones. They exist to catch a
 * slipped decimal point ("1750" cm) before a round trip, not to tell anyone
 * their body is out of range.
 *
 * They are **exactly the gateway's own** `@Min` / `@Max` (weight 1–500,
 * height 30–280, both on `RegisterInput` and `UpdateProfileInput`) — not a
 * narrower client-side guess. An earlier version of this file used a tighter
 * range (20–300 / 50–250) specifically so a client check would never be
 * *looser* than a plausibility judgement profile wanted to make. That was
 * reversed: this file's own rule is that nothing here may be stricter than
 * the gateway on a column the server would otherwise accept, and a narrower
 * client range broke that rule the same way the old `{9,10}` phone regex did
 * — a value the server would store silently became one the app refused to
 * save. See `modules/auth/lib/validation.ts`'s docblock for the account-vs-
 * non-account distinction that rule turns on.
 *
 * One real thing is given up by widening rather than keeping the tighter
 * range: catching a slipped decimal / stray zero depends on the typo'd value
 * landing outside the range, and a wider range is a smaller target. The named
 * case above still lands cleanly outside either range no matter which one is
 * in force — 1750 cm and 1750 kg are absurd at 250/300 *and* at 280/500. What
 * stops being caught is narrower: a true weight in roughly 31–50 kg, typo'd
 * with one extra trailing zero (310–500), no longer exceeds the new 500 kg
 * ceiling the way it exceeded the old 300 kg one. That gap is accepted, not
 * overlooked — it is the cost of matching the server exactly, and the
 * alternative (keeping the old ceiling) is the violation this rewrite exists
 * to remove.
 *
 * Messages are Thai because they surface to the user.
 */

export const WEIGHT_RANGE_KG = { min: 1, max: 500 } as const;
export const HEIGHT_RANGE_CM = { min: 30, max: 280 } as const;
/** Matches the gateway's column exactly; a longer note is truncated server-side. */
export const CONGENITAL_DISEASE_MAX = 500;
/** Nobody alive was born earlier, and a typo'd year is the real target. */
export const MAX_AGE_YEARS = 120;

/**
 * Empty is valid — every field using this is optional. Returns a Thai message
 * if the value is present and implausible.
 */
export function validateMeasurement(
  raw: string,
  { min, max }: { min: number; max: number },
  unit: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 'กรุณากรอกเป็นตัวเลข';
  if (parsed < min || parsed > max) return `กรุณากรอกระหว่าง ${min}-${max} ${unit}`;

  return null;
}

/**
 * A birthday one form accepts and another refuses is a bug the patient meets
 * only when someone edits on their behalf, so all three forms run this one.
 */
export function validateDob(dob: Date | null, now: Date = new Date()): string | null {
  if (!dob) return null;

  const oldest = new Date(now);
  oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);

  if (dob.getTime() > now.getTime()) return 'วันเกิดต้องไม่เป็นวันในอนาคต';
  if (dob.getTime() < oldest.getTime()) return 'กรุณาตรวจสอบปีเกิดอีกครั้ง';

  return null;
}

/**
 * Length only — the column takes free text and the gateway stores whatever
 * fits. Trimmed first, so trailing whitespace cannot push a note over the
 * limit that the server would have accepted after its own trim.
 */
export function validateCongenitalDisease(raw: string): string | null {
  if (raw.trim().length > CONGENITAL_DISEASE_MAX) {
    return `กรอกได้ไม่เกิน ${CONGENITAL_DISEASE_MAX} ตัวอักษร`;
  }

  return null;
}
