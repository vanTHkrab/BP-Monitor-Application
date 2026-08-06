/**
 * The caregiver's health-edit form: its shape, its validation, and the diff
 * that decides what is worth sending.
 *
 * ## Why this is not `modules/profile/lib/form-state.ts`
 *
 * That file builds an `UpdateProfileInput`, which carries `firstname`,
 * `lastname`, `phone`, `email` and `avatar` alongside the five health fields.
 * A caregiver may write **none** of those: `email` and `phone` are unique
 * login identities, and a caregiver who could change the email could request
 * a password reset and take the account. The gateway keeps them out by giving
 * `updatePatientHealth` its own input type rather than widening
 * `UpdateProfileInput`; this file is the client half of the same decision.
 * Reusing the profile diff and "just not rendering" the other inputs would
 * leave five writable fields one refactor away from the wire.
 *
 * So the patch is built by iterating `HEALTH_FIELDS` — never
 * `Object.keys(form)`. A field added to the form without being added there is
 * inert instead of silently writable, which is the same guard
 * `caregiver.service.ts` puts on its own loop.
 *
 * ## Why only *changed* fields are sent, and why that is load-bearing here
 *
 * `myPatients` — the only list a caregiver can read a patient's health from —
 * carries `dob`, `weight` and `height` and **not** `gender` or
 * `congenitalDisease`. There is no query that returns those two to a
 * caregiver; `PatientHealthProfileType` exists only as this mutation's return
 * value. (Flagged: `caregiver.resolver.ts` says "a caregiver who wants to
 * know the current values can read them from `myPatients`", which is true of
 * three fields out of five. Closing the gap is a gateway change — adding
 * `gender` and `congenitalDisease` to `PatientSummaryType` — and is not this
 * change's to make.)
 *
 * Submitting the whole form would therefore send `gender: null` and
 * `congenitalDisease: null` on every save and **erase** two columns the
 * caregiver was never shown. The gateway distinguishes an absent key ("leave
 * alone") from an explicit `null` ("clear it"), so the fix is exact: those
 * two fields start empty, and an empty field that started empty is not in the
 * patch. Typing into one sends it; leaving it alone cannot clear it.
 *
 * The cost is stated on the screen rather than hidden: a caregiver cannot
 * *clear* a congenital disease they cannot see. Refusing to erase data you
 * were not shown is the right side of that trade for a medical record.
 */
import { formatIsoDate } from '@/utils/date-formatter';

import type { FieldErrors } from '../../auth/lib/validation';
import type { Gender } from '../../auth/types';
// Deep import for the reason `modules/profile/lib/validation.ts` gives about
// its own: the barrel rule guards cache invalidation, which two pure lib
// files cannot skip, and `@/modules/profile`'s barrel drags an image picker
// in behind `use-profile-avatar`.
import {
  HEIGHT_RANGE_CM,
  WEIGHT_RANGE_KG,
  CONGENITAL_DISEASE_MAX,
  validateDob,
  validateMeasurement,
} from '../../profile/lib/validation';
import {
  HEALTH_FIELDS,
  type HealthFieldName,
  type PatientHealthProfile,
  type PatientSummary,
  type UpdatePatientHealthInput,
} from '../types';

/**
 * All-strings for the two numeric fields, for the reason `modules/profile`'s
 * `ProfileForm` gives: a `TextInput` produces a string, and converting on
 * every keystroke makes backspacing the last digit snap the field back to its
 * old value.
 */
export type HealthForm = {
  dob: Date | null;
  gender: Gender | null;
  weight: string;
  height: string;
  congenitalDisease: string;
};

export type HealthErrors = FieldErrors<HealthFieldName>;

/**
 * What the form started as. Compared field-by-field to decide the patch, and
 * kept separately from the form rather than re-derived from `patient` so that
 * a successful save can re-baseline without a refetch.
 */
export type HealthBaseline = HealthForm;

const EMPTY_BASELINE: HealthBaseline = {
  dob: null,
  gender: null,
  weight: '',
  height: '',
  congenitalDisease: '',
};

/**
 * Seed the form from what the caregiver can actually see.
 *
 * `patient` supplies `dob`, `weight` and `height`. `known` is the profile a
 * previous save returned in this session — the only way `gender` and
 * `congenitalDisease` are ever populated for a caregiver — and takes
 * precedence where it has an answer, because it is strictly newer than the
 * cached `myPatients` row that produced `patient`.
 */
export function healthFormFromPatient(
  patient: PatientSummary | null,
  known?: PatientHealthProfile | null,
): HealthForm {
  const dob = known?.dob ?? patient?.dob ?? null;
  const weight = known?.weight ?? patient?.weight;
  const height = known?.height ?? patient?.height;

  return {
    ...EMPTY_BASELINE,
    dob,
    gender: known?.gender ?? null,
    weight: weight != null ? String(weight) : '',
    height: height != null ? String(height) : '',
    congenitalDisease: known?.congenitalDisease ?? '',
  };
}

/** Same day, ignoring time — `dob` is a calendar day and its column is a bare DATE. */
const sameDay = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : a.toDateString() === b.toDateString();

/** `''` and "absent" are the same value for a text column. */
const sameText = (a: string, b: string): boolean => a.trim() === b.trim();

/**
 * Compared as numbers: "70" and "70.0" are one weight, and re-sending it
 * because the caregiver retyped it would put a no-op row in the patient's
 * audit trail. The gateway also dedupes, on rendered text — this just keeps
 * the request itself honest about what it is asking for.
 */
const sameNumber = (a: string, b: string): boolean => {
  const [left, right] = [a.trim(), b.trim()];
  if (!left || !right) return left === right;
  const [x, y] = [Number(left), Number(right)];
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
};

/**
 * Build one field's entry, or `undefined` when it did not change.
 *
 * Returns `null` for a field the caregiver cleared — never `undefined` —
 * because `undefined` does not survive JSON serialisation and would reach the
 * gateway as an absent key, which means "leave this column alone": the
 * opposite of what clearing a field asks for.
 */
function diffField(
  field: HealthFieldName,
  form: HealthForm,
  baseline: HealthBaseline,
): { changed: false } | { changed: true; value: string | number | Gender | null } {
  switch (field) {
    case 'dob':
      return sameDay(form.dob, baseline.dob)
        ? { changed: false }
        : { changed: true, value: form.dob ? formatIsoDate(form.dob) : null };

    case 'gender':
      return (form.gender ?? null) === (baseline.gender ?? null)
        ? { changed: false }
        : { changed: true, value: form.gender };

    case 'weight':
    case 'height': {
      const [next, before] = [form[field], baseline[field]];
      if (sameNumber(next, before)) return { changed: false };
      const trimmed = next.trim();
      return { changed: true, value: trimmed ? Number(trimmed) : null };
    }

    case 'congenitalDisease': {
      if (sameText(form.congenitalDisease, baseline.congenitalDisease)) {
        return { changed: false };
      }
      return { changed: true, value: form.congenitalDisease.trim() || null };
    }
  }
}

/**
 * The mutation input: only the fields that differ from the baseline, and
 * never anything outside `HEALTH_FIELDS`.
 */
export function changedHealthFields(
  form: HealthForm,
  baseline: HealthBaseline,
): UpdatePatientHealthInput {
  const patch: UpdatePatientHealthInput = {};

  for (const field of HEALTH_FIELDS) {
    const result = diffField(field, form, baseline);
    if (!result.changed) continue;
    // The union is narrowed per branch above; the cast is at the assembly
    // point rather than inside each branch so the loop stays the single place
    // that decides what a patch may contain.
    (patch as Record<HealthFieldName, unknown>)[field] = result.value;
  }

  return patch;
}

export const hasHealthChanges = (patch: UpdatePatientHealthInput): boolean =>
  Object.keys(patch).length > 0;

/**
 * Plausibility checks, not medical ones — deliberately wide. They exist to
 * catch a slipped decimal ("1750" cm) before a round trip, and they are the
 * *same* checks `app/profile.tsx` runs, imported rather than restated: a
 * caregiver form stricter or looser than the patient's own would disagree
 * about the same column.
 */
export function validateHealthForm(form: HealthForm, now: Date = new Date()): HealthErrors {
  const errors: HealthErrors = {};

  const dobError = validateDob(form.dob, now);
  if (dobError) errors.dob = dobError;

  const weightError = validateMeasurement(form.weight, WEIGHT_RANGE_KG, 'กก.');
  if (weightError) errors.weight = weightError;

  const heightError = validateMeasurement(form.height, HEIGHT_RANGE_CM, 'ซม.');
  if (heightError) errors.height = heightError;

  if (form.congenitalDisease.trim().length > CONGENITAL_DISEASE_MAX) {
    errors.congenitalDisease = `กรอกได้ไม่เกิน ${CONGENITAL_DISEASE_MAX} ตัวอักษร`;
  }

  return errors;
}
