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
 * ## Why only *changed* fields are sent
 *
 * The gateway distinguishes an absent key ("leave this column alone") from an
 * explicit `null` ("clear it"), and this builds the patch accordingly: a field
 * the user did not touch is absent, a field they emptied is `null`.
 *
 * That matters because two caregivers can look after the same patient. Sending
 * the whole form would make every save a full overwrite, so the second one to
 * submit would silently revert a field the first had just changed — without
 * either of them editing it. A patch cannot do that.
 *
 * It mattered more before `PatientSummaryType` carried `gender` and
 * `congenitalDisease`: the form could not read them, so a full submit would
 * have sent `null` for both and erased columns nobody was shown. That gap is
 * closed — the readable set and the editable set are now the same five — but
 * the patch stays, on its own merits.
 */
import { formatIsoDate } from '@/utils/date-formatter';

import type { FieldErrors } from '../../auth/lib/validation';
import type { Gender } from '../../auth/types';
// Neutral module, not `modules/profile`: the patient's own form, the sign-up
// form, and this one all write the same columns, so the rules belong to none
// of the three. Reaching into profile for them also made this file's imports
// read as if the caregiver form were a variant of the profile form, which the
// docblock above spends thirty lines saying it is not.
import {
  HEIGHT_RANGE_CM,
  WEIGHT_RANGE_KG,
  congenitalAnswerFrom,
  congenitalTextFrom,
  congenitalWireValue,
  hasHealthRecord,
  renderCongenital,
  validateCongenitalDisease,
  validateDob,
  validateHealthBlock,
  validateMeasurement,
  type CongenitalAnswer,
} from '@/lib/health-validation';
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
  /**
   * มี / ไม่มี, `null` while unanswered. Same two-control split as
   * `modules/profile`'s `ProfileForm`, and for the same reason — the gateway
   * stores "no condition" as a NULL column and renders it back as the string
   * `'ไม่มี'`, so an empty text box is not an answer.
   */
  congenital: CongenitalAnswer | null;
  congenitalDisease: string;
};

/**
 * `congenital` is an error slot with no column behind it: the select and the
 * text box can each be wrong on their own, and one shared message would put
 * "กรุณาระบุโรคประจำตัว" under a text box that is not on screen.
 */
export type HealthErrors = FieldErrors<HealthFieldName | 'congenital'>;

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
  congenital: null,
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
  // `known` is what this session's last save returned, so it wins over the
  // list, which was fetched before that save.
  const dob = known?.dob ?? patient?.dob ?? null;
  const weight = known?.weight ?? patient?.weight;
  const height = known?.height ?? patient?.height;
  const gender = known?.gender ?? patient?.gender ?? null;
  const congenital = known?.congenitalDisease ?? patient?.congenitalDisease;

  return {
    ...EMPTY_BASELINE,
    dob,
    gender: (gender as HealthForm['gender']) ?? null,
    weight: weight != null ? String(weight) : '',
    height: height != null ? String(height) : '',
    // `'ไม่มี'` on the wire is a rendered NULL, so it seeds the select and
    // leaves the text box empty. Seeding it into the text box would make the
    // caregiver appear to have typed it, and re-saving would store it.
    congenital: congenitalAnswerFrom(congenital),
    congenitalDisease: congenitalTextFrom(congenital),
  };
}

/**
 * Does the patient already have a health row?
 *
 * The four required columns are all-or-nothing on the gateway — the row's
 * upsert needs every one of them to insert — so this is one question, not
 * four. It decides whether the form is refusing a *clear* or asking the
 * caregiver to *complete* the block; see `validateHealthBlock`.
 */
export const patientHasHealthRecord = (
  patient: PatientSummary | null,
  known?: PatientHealthProfile | null,
): boolean =>
  hasHealthRecord({
    dob: known?.dob ?? patient?.dob,
    gender: known?.gender ?? patient?.gender,
    weight: known?.weight ?? patient?.weight,
    height: known?.height ?? patient?.height,
  });

/** Same day, ignoring time — `dob` is a calendar day and its column is a bare DATE. */
const sameDay = (a: Date | null, b: Date | null): boolean =>
  a === null || b === null ? a === b : a.toDateString() === b.toDateString();

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
      // Compared in the gateway's own rendering, not in the form's two-part
      // representation: 'ไม่มี' from the server seeds `congenital: 'none'`
      // with an empty text box, and comparing the text boxes alone would
      // report a change — and write an audit-trail row — on every save for
      // every patient who answered "ไม่มี".
      const next = renderCongenital(form.congenital, form.congenitalDisease);
      const before = renderCongenital(baseline.congenital, baseline.congenitalDisease);
      if (next === before) return { changed: false };

      const wire = congenitalWireValue(form.congenital, form.congenitalDisease);
      // Unanswered: nothing to say about the column, so nothing is sent.
      return wire === undefined ? { changed: false } : { changed: true, value: wire };
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
 * *same* checks `app/profile.tsx` and the sign-up form run, imported from
 * `@/lib/health-validation` rather than restated: a caregiver form stricter or
 * looser than the patient's own would disagree about the same column.
 */
export function validateHealthForm(
  form: HealthForm,
  now: Date = new Date(),
  { recorded = false }: { recorded?: boolean } = {},
): HealthErrors {
  const errors: HealthErrors = {};

  const dobError = validateDob(form.dob, now);
  if (dobError) errors.dob = dobError;

  const weightError = validateMeasurement(form.weight, WEIGHT_RANGE_KG, 'กก.');
  if (weightError) errors.weight = weightError;

  const heightError = validateMeasurement(form.height, HEIGHT_RANGE_CM, 'ซม.');
  if (heightError) errors.height = heightError;

  const congenitalError = validateCongenitalDisease(form.congenitalDisease);
  if (congenitalError) errors.congenitalDisease = congenitalError;

  /*
   * Presence, last, so a plausibility message is never overwritten by a
   * "please fill this in" for a field that is filled in.
   *
   * This is the half that stops the form asking for something the gateway
   * will refuse: `dob` / `gender` / `weight` / `height` are `NOT NULL` on
   * `user_informations`, so clearing one is a 400 and a partial edit that
   * cannot create a missing row is a 400 too. `recorded` says which of those
   * two the caregiver is about to do.
   */
  Object.assign(errors, validateHealthBlock(form, { recorded }));

  return errors;
}
