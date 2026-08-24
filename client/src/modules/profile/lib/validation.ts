/**
 * Client-side validation for the profile form.
 *
 * Same contract as `modules/auth/lib/validation.ts`, and it reuses that
 * file's phone rule rather than restating it: the two screens write the same
 * `phone` column, and a profile form stricter than the register form would
 * make an account unable to re-save the number it signed up with.
 *
 * The health block is no longer optional in the way it used to be. `dob`,
 * `gender`, `weight` and `height` are `NOT NULL` on the gateway's
 * `user_informations` row, so clearing one is a 400 and a partial edit that
 * cannot create the row is a 400 too. What this file adds on top of the
 * shared rules is *presence*, and it adds it conditionally — see
 * [ProfileBaseline]. The bounds and the measurement validators are **not
 * defined here** — they live in
 * `@/lib/health-validation`, because `modules/auth` (sign-up) and
 * `modules/caregivers` (editing on the patient's behalf) write the same
 * columns and a rule only one of them enforces produces a value that form then
 * refuses to re-save. They are re-exported below so this file's public shape
 * is unchanged for anything that already imported them from here.
 */
// Reached by path, not through `@/modules/auth`'s barrel: the barrel pulls in
// `bootstrap.ts` → AsyncStorage → a native module, and a pure validation
// function must not drag a native dependency in behind it. The barrel rule
// exists to stop screens skipping the hooks' cache invalidation, which does
// not apply between two pure lib files.
import { z } from 'zod';

import { isValidPhone, type FieldErrors } from '@/modules/auth/lib/validation';
import {
  HEIGHT_RANGE_CM,
  WEIGHT_RANGE_KG,
  hasHealthRecord,
  validateCongenitalDisease,
  validateDob,
  validateHealthBlock,
  validateMeasurement,
} from '@/lib/health-validation';
import { stripPhoneDigits } from '@/utils/phone-format';

import type { ProfileField, ProfileForm } from '../types';

export {
  CONGENITAL_DISEASE_MAX,
  CONGENITAL_OPTIONS,
  HEIGHT_RANGE_CM,
  MAX_AGE_YEARS,
  WEIGHT_RANGE_KG,
  hasHealthRecord,
  validateCongenitalDisease,
  validateDob,
  validateMeasurement,
} from '@/lib/health-validation';

export type ProfileErrors = FieldErrors<ProfileField>;

/**
 * The record the form was seeded from, as much of it as the rules need.
 *
 * Structural rather than `User` so this file keeps importing nothing from
 * `modules/auth` but its phone rule — a `User` satisfies it as-is.
 *
 * Two rules turn on it, and both are the same idea: **you may not clear what
 * you have, but you are not blocked by what you never had.** Passing
 * `undefined` (no record yet) is the permissive end of both.
 */
export type ProfileBaseline = {
  lastname?: string;
  dob?: Date;
  gender?: string;
  weight?: number;
  height?: number;
};

export function validateProfile(
  form: ProfileForm,
  now: Date = new Date(),
  baseline?: ProfileBaseline | null,
): ProfileErrors {
  const errors: ProfileErrors = {};

  if (!form.firstname.trim()) errors.firstname = 'กรุณากรอกชื่อ';
  /*
   * `lastname` is required **only if the record has one**.
   *
   * `UserType.lastname` is `String!`, but `''` satisfies that and the gateway
   * deliberately produces it: a Google account whose name is a single word
   * gets `lastname: ''` from `deriveGoogleName`, because inventing a surname
   * would be a sentinel nobody could tell from a real one. An unconditional
   * requirement here would open that user's edit form already in an error
   * state, with no way to save their weight — or anything else — until they
   * made a surname up. Unreachable today (Google sign-in is flag-gated off),
   * which is exactly why it is worth not shipping.
   *
   * The requirement is kept for everyone who does have a surname, so this is
   * not a loosening of the register form's rule — an account cannot lose a
   * name it has by emptying the box, which is the failure the rule was for.
   */
  if (baseline?.lastname?.trim() && !form.lastname.trim()) {
    errors.lastname = 'กรุณากรอกนามสกุล';
  }

  const phone = stripPhoneDigits(form.phone);
  if (!phone) errors.phone = 'กรุณากรอกเบอร์โทรศัพท์';
  else if (!isValidPhone(phone)) errors.phone = 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-15 หลัก';

  const dobError = validateDob(form.dob, now);
  if (dobError) errors.dob = dobError;

  const weightError = validateMeasurement(form.weight, WEIGHT_RANGE_KG, 'กก.');
  if (weightError) errors.weight = weightError;

  const heightError = validateMeasurement(form.height, HEIGHT_RANGE_CM, 'ซม.');
  if (heightError) errors.height = heightError;

  const congenitalError = validateCongenitalDisease(form.congenitalDisease);
  if (congenitalError) errors.congenitalDisease = congenitalError;

  /*
   * Presence, last, so a plausibility message above is never overwritten by a
   * "please fill this in" for a field that *is* filled in.
   *
   * `recorded` is the whole health block, not a field at a time: a strict
   * subset of the four is unrepresentable on the gateway (the row's upsert
   * needs all four to insert), so the record either has them all or has no
   * row. See `validateHealthBlock`.
   */
  Object.assign(errors, validateHealthBlock(form, {
    recorded: baseline ? hasHealthRecord(baseline) : false,
  }));

  return errors;
}


/**
 * The same rules as [validateProfile], shaped for `zodResolver`.
 *
 * A thin `superRefine` wrapper rather than a second set of rules written in
 * zod's vocabulary, exactly as `auth/lib/validation.ts`'s `registerSchema`
 * wraps `validateRegister`. Two encodings of one rule set is how the profile
 * form ends up refusing a value the register form accepts — the failure this
 * file's own header says it exists to prevent — and it would arrive silently,
 * because nothing type-checks one against the other.
 *
 * `now` is a parameter for the same reason it is one on [validateProfile]:
 * `validateDob` compares against it, and a schema built once at module load
 * would freeze "today" at the moment the bundle was evaluated.
 *
 * `baseline` is threaded through for the same reason, and it is why the
 * screen has to memoize this on the user rather than once per mount: the two
 * conditional rules ([ProfileBaseline]) read it, and a schema built before
 * `me` resolved would judge the form against an empty record.
 *
 * `gender` is still declared nullable in the base shape — the presence rule
 * for it lives in `validateHealthBlock`, with the other three, because all
 * four stand or fall together. `email` is absent because this screen does not
 * write it — see the header of `app/profile.tsx`.
 */
export function profileSchema(now: Date = new Date(), baseline?: ProfileBaseline | null) {
  return z
    .object({
      firstname: z.string(),
      lastname: z.string(),
      phone: z.string(),
      dob: z.date().nullable(),
      gender: z.enum(['male', 'female', 'other']).nullable(),
      weight: z.string(),
      height: z.string(),
      congenital: z.enum(['has', 'none']).nullable(),
      congenitalDisease: z.string(),
    })
    .superRefine((values, ctx) => {
      const errors = validateProfile(values, now, baseline);
      for (const [field, message] of Object.entries(errors)) {
        if (message) ctx.addIssue({ code: 'custom', message, path: [field] });
      }
    });
}
