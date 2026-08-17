/**
 * Client-side validation for the profile form.
 *
 * Same contract as `modules/auth/lib/validation.ts`, and it reuses that
 * file's phone rule rather than restating it: the two screens write the same
 * `phone` column, and a profile form stricter than the register form would
 * make an account unable to re-save the number it signed up with.
 *
 * Everything except the name fields is optional. The bounds and the two
 * measurement validators are **not defined here** — they live in
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
import { isValidPhone, type FieldErrors } from '@/modules/auth/lib/validation';
import {
  HEIGHT_RANGE_CM,
  WEIGHT_RANGE_KG,
  validateCongenitalDisease,
  validateDob,
  validateMeasurement,
} from '@/lib/health-validation';
import { stripPhoneDigits } from '@/utils/phone-format';

import type { ProfileField, ProfileForm } from '../types';

export {
  CONGENITAL_DISEASE_MAX,
  HEIGHT_RANGE_CM,
  MAX_AGE_YEARS,
  WEIGHT_RANGE_KG,
  validateCongenitalDisease,
  validateDob,
  validateMeasurement,
} from '@/lib/health-validation';

export type ProfileErrors = FieldErrors<ProfileField>;

export function validateProfile(form: ProfileForm, now: Date = new Date()): ProfileErrors {
  const errors: ProfileErrors = {};

  if (!form.firstname.trim()) errors.firstname = 'กรุณากรอกชื่อ';
  if (!form.lastname.trim()) errors.lastname = 'กรุณากรอกนามสกุล';

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

  return errors;
}
