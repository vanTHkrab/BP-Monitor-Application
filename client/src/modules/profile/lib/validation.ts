/**
 * Client-side validation for the profile form.
 *
 * Same contract as `modules/auth/lib/validation.ts`, and it reuses that
 * file's phone rule rather than restating it: the two screens write the same
 * `phone` column, and a profile form stricter than the register form would
 * make an account unable to re-save the number it signed up with.
 *
 * Everything except the name fields is optional. The bounds below are
 * plausibility checks, not medical ones — they exist to catch a slipped
 * decimal point ("1750" cm) before a round trip, not to tell anyone their
 * body is out of range. They are deliberately wide for that reason.
 */
// Reached by path, not through `@/modules/auth`'s barrel: the barrel pulls in
// `bootstrap.ts` → AsyncStorage → a native module, and a pure validation
// function must not drag a native dependency in behind it. The barrel rule
// exists to stop screens skipping the hooks' cache invalidation, which does
// not apply between two pure lib files.
import { isValidPhone, type FieldErrors } from '@/modules/auth/lib/validation';
import { stripPhoneDigits } from '@/utils/phone-format';

import type { ProfileField, ProfileForm } from '../types';

export const WEIGHT_RANGE_KG = { min: 20, max: 300 } as const;
export const HEIGHT_RANGE_CM = { min: 50, max: 250 } as const;
/** Matches the gateway's column; a longer note is truncated server-side. */
export const CONGENITAL_DISEASE_MAX = 500;
/** Nobody alive was born earlier, and a typo'd year is the real target. */
export const MAX_AGE_YEARS = 120;

export type ProfileErrors = FieldErrors<ProfileField>;

/** Empty is valid — these fields are optional. Returns a Thai message if not. */
function validateMeasurement(
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

export function validateProfile(form: ProfileForm, now: Date = new Date()): ProfileErrors {
  const errors: ProfileErrors = {};

  if (!form.firstname.trim()) errors.firstname = 'กรุณากรอกชื่อ';
  if (!form.lastname.trim()) errors.lastname = 'กรุณากรอกนามสกุล';

  const phone = stripPhoneDigits(form.phone);
  if (!phone) errors.phone = 'กรุณากรอกเบอร์โทรศัพท์';
  else if (!isValidPhone(phone)) errors.phone = 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก';

  if (form.dob) {
    const oldest = new Date(now);
    oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);

    if (form.dob.getTime() > now.getTime()) errors.dob = 'วันเกิดต้องไม่เป็นวันในอนาคต';
    else if (form.dob.getTime() < oldest.getTime()) errors.dob = 'กรุณาตรวจสอบปีเกิดอีกครั้ง';
  }

  const weightError = validateMeasurement(form.weight, WEIGHT_RANGE_KG, 'กก.');
  if (weightError) errors.weight = weightError;

  const heightError = validateMeasurement(form.height, HEIGHT_RANGE_CM, 'ซม.');
  if (heightError) errors.height = heightError;

  if (form.congenitalDisease.trim().length > CONGENITAL_DISEASE_MAX) {
    errors.congenitalDisease = `กรอกได้ไม่เกิน ${CONGENITAL_DISEASE_MAX} ตัวอักษร`;
  }

  return errors;
}
