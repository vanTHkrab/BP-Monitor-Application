/**
 * Client-side form validation for the auth screens.
 *
 * Pure, and deliberately *not* a mirror of the gateway's rules. The server
 * validates for correctness; this validates to save a round trip on mistakes
 * the user can see for themselves. Where the two disagree, the server wins —
 * so nothing that identifies an account may be stricter than `RegisterInput`'s
 * class-validator decorators, or a legitimate account becomes unreachable from
 * the app. That rule is why `isValidPhone` is `{9,15}` and not `{9,10}`.
 *
 * The health block follows the same rule, not an exception to it:
 * `@/lib/health-validation`'s weight and height bounds are the gateway's own
 * `@Min` / `@Max` exactly, so a value this form accepts is a value the
 * profile screen and the server both accept too. An earlier version of this
 * file used a narrower client-side range there, on the theory that those
 * columns do not identify anyone so a stricter client was affordable — that
 * was reversed because it was still the same failure this whole file exists
 * to prevent: a value the server would store that the app refuses to save.
 * The trade-off it costs instead is written out in `@/lib/health-validation`.
 *
 * The health block is required on the register form specifically — that is a
 * **client-only UX policy**, not a wire-contract change: `RegisterInput`'s
 * `dob` / `gender` / `weight` / `height` / `congenitalDisease` stay optional
 * on the gateway (the profile and caregiver forms still leave them optional),
 * so "must be present to submit *this* form" is layered on top of, not
 * instead of, the shared plausibility checks below. It cannot itself violate
 * the never-stricter-than-the-gateway rule, because refusing to submit an
 * empty field is not refusing a value the server would have accepted — the
 * server was never offered a value at all.
 *
 * Nothing here may be **looser** in a way that guarantees a server rejection
 * either: a 73-character password or an 81-character name is refused by
 * `RegisterInput` with an English class-validator message the user cannot
 * attribute to a field, so both are caught here where the field is known.
 *
 * Returns a map of field → Thai message. Empty means "nothing obviously
 * wrong", not "the server will accept this".
 *
 * `registerSchema()` re-expresses `validateRegister` as a Zod schema so the
 * register screen can wire it through `zodResolver` for React Hook Form. It
 * is a thin adapter around the function above, not a second copy of the
 * rules — every message it can produce comes from calling `validateRegister`
 * and turning its `FieldErrors` map into Zod issues. Keeping the pure
 * function as the source of truth is what lets `validation.test.ts` keep
 * testing plain input/output pairs instead of asserting on Zod's issue shape.
 */
import { z } from 'zod';

import {
  HEIGHT_RANGE_CM,
  WEIGHT_RANGE_KG,
  validateCongenitalDisease,
  validateDob,
  validateMeasurement,
} from '@/lib/health-validation';
import { stripPhoneDigits } from '@/utils/phone-format';
import type { Gender, RegisterInput } from '../types';

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type LoginField = 'phone' | 'password';
export type RegisterField =
  | LoginField
  | 'firstname'
  | 'lastname'
  | 'email'
  | 'confirmPassword'
  | 'dob'
  | 'gender'
  | 'weight'
  | 'height'
  | 'congenitalDisease';
export type ForgotPasswordField = 'email';
export type ResetPasswordField = 'otp' | 'password' | 'confirmPassword';

/** Matches the gateway's `PASSWORD_MIN`. */
export const PASSWORD_MIN = 8;
/** Matches the gateway's `PASSWORD_MAX`, which is bcrypt's hard input limit. */
export const PASSWORD_MAX = 72;
/** Matches `RegisterInput`'s `@Length(1, 80)` on both name fields. */
export const NAME_MAX = 80;

/**
 * Accepts 9 to 15 digits, which is exactly the gateway's `PHONE_REGEX`
 * (`/^[0-9]{9,15}$/`, covering Thai plus international numbers).
 *
 * It was `{9,10}` and that was a bug of precisely the kind the docblock above
 * warns against: an 11-digit number is legal server-side, so an account
 * holding one could not be registered, signed in to, or re-saved from the
 * profile screen. Widening it costs nothing — the gateway is still the real
 * gate — and it removes three screens' worth of unreachable accounts.
 */
export const isValidPhone = (digits: string): boolean => /^\d{9,15}$/.test(digits);

/**
 * Intentionally loose. Anything stricter rejects addresses that are legal and
 * that the server would have accepted — the cost of a false negative here is
 * a user who cannot register at all.
 */
export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function validateLogin(input: { phone: string; password: string }): FieldErrors<LoginField> {
  const errors: FieldErrors<LoginField> = {};
  const phone = stripPhoneDigits(input.phone);

  if (!phone) errors.phone = 'กรุณากรอกเบอร์โทรศัพท์';
  else if (!isValidPhone(phone)) errors.phone = 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-15 หลัก';

  if (!input.password) errors.password = 'กรุณากรอกรหัสผ่าน';

  return errors;
}

/**
 * The health block is typed as the *form* holds it, not as `RegisterInput`
 * declares it: the picker yields a `Date`, and the two numeric inputs hold
 * strings because converting on every keystroke makes backspacing the last
 * digit snap the field back to its old value. Every one of these is now
 * required to submit the register form (the avatar is the only field that
 * stays optional), so none of them carry a `?` here — a controlled React
 * Hook Form always has a value for a field, even if that value is `''` or
 * `null` pending its own "please fill this in" error.
 */
export type RegisterFormValues = Pick<
  RegisterInput,
  'firstname' | 'lastname' | 'phone' | 'password' | 'email'
> & {
  confirmPassword: string;
  dob: Date | null;
  gender: Gender | null;
  weight: string;
  height: string;
  congenitalDisease: string;
};

export function validateRegister(
  values: RegisterFormValues,
  now: Date = new Date(),
): FieldErrors<RegisterField> {
  const errors: FieldErrors<RegisterField> = {};
  const phone = stripPhoneDigits(values.phone);

  if (!values.firstname.trim()) errors.firstname = 'กรุณากรอกชื่อ';
  else if (values.firstname.trim().length > NAME_MAX)
    errors.firstname = `ชื่อต้องไม่เกิน ${NAME_MAX} ตัวอักษร`;

  if (!values.lastname.trim()) errors.lastname = 'กรุณากรอกนามสกุล';
  else if (values.lastname.trim().length > NAME_MAX)
    errors.lastname = `นามสกุลต้องไม่เกิน ${NAME_MAX} ตัวอักษร`;

  if (!phone) errors.phone = 'กรุณากรอกเบอร์โทรศัพท์';
  else if (!isValidPhone(phone)) errors.phone = 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-15 หลัก';

  // Required since the Better Auth migration — it was optional before, and a
  // registration without one is now rejected before it reaches the resolver.
  if (!values.email.trim()) errors.email = 'กรุณากรอกอีเมล';
  else if (!isValidEmail(values.email.trim())) errors.email = 'รูปแบบอีเมลไม่ถูกต้อง';

  if (!values.password) errors.password = 'กรุณากรอกรหัสผ่าน';
  else if (values.password.length < PASSWORD_MIN)
    errors.password = `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`;
  // Not a style preference: bcrypt silently ignores input past 72 bytes, so
  // the gateway refuses it outright rather than hashing a password whose tail
  // does nothing. Caught here, the message names the field.
  else if (values.password.length > PASSWORD_MAX)
    errors.password = `รหัสผ่านต้องไม่เกิน ${PASSWORD_MAX} ตัวอักษร`;

  if (!values.confirmPassword) errors.confirmPassword = 'กรุณายืนยันรหัสผ่าน';
  else if (values.confirmPassword !== values.password)
    errors.confirmPassword = 'รหัสผ่านไม่ตรงกัน';

  // The health block. It is required on *this* form — see the docblock at
  // the top of the file for why that is a client-only UX policy rather than
  // a wire-contract change. Each field checks presence first, then defers to
  // the shared plausibility rule from `@/lib/health-validation`, which is
  // itself unchanged and still treats an empty value as fine on its own — a
  // value this form accepts and the profile screen rejects is one the user
  // can never correct.
  if (!values.dob) errors.dob = 'กรุณาเลือกวันเกิด';
  else {
    const dobError = validateDob(values.dob, now);
    if (dobError) errors.dob = dobError;
  }

  if (!values.gender) errors.gender = 'กรุณาเลือกเพศ';

  if (!values.weight.trim()) errors.weight = 'กรุณากรอกน้ำหนัก';
  else {
    const weightError = validateMeasurement(values.weight, WEIGHT_RANGE_KG, 'กก.');
    if (weightError) errors.weight = weightError;
  }

  if (!values.height.trim()) errors.height = 'กรุณากรอกส่วนสูง';
  else {
    const heightError = validateMeasurement(values.height, HEIGHT_RANGE_CM, 'ซม.');
    if (heightError) errors.height = heightError;
  }

  if (!values.congenitalDisease.trim()) errors.congenitalDisease = 'กรุณากรอกโรคประจำตัว';
  else {
    const congenitalError = validateCongenitalDisease(values.congenitalDisease);
    if (congenitalError) errors.congenitalDisease = congenitalError;
  }

  return errors;
}

/**
 * The Zod adapter React Hook Form drives via `zodResolver`.
 *
 * `now` is a constructor argument rather than baked in because `validateDob`
 * needs one and a schema has to be built fresh to close over it — Zod has no
 * hook for threading extra arguments through `superRefine` at parse time.
 * The register screen calls this once, memoized; tests that care about the
 * date boundary (`dob` in the future, or 120+ years old) pass a fixed `now`
 * the same way they already do for `validateRegister`.
 *
 * The base shape below only checks JS type — every Thai message still comes
 * from `validateRegister` itself, reused rather than re-expressed, so there
 * is exactly one place that decides what each field requires.
 */
export function registerSchema(now: Date = new Date()) {
  return z
    .object({
      firstname: z.string(),
      lastname: z.string(),
      phone: z.string(),
      email: z.string(),
      password: z.string(),
      confirmPassword: z.string(),
      dob: z.date().nullable(),
      gender: z.enum(['male', 'female', 'other']).nullable(),
      weight: z.string(),
      height: z.string(),
      congenitalDisease: z.string(),
    })
    .superRefine((values, ctx) => {
      const errors = validateRegister(values, now);
      for (const [field, message] of Object.entries(errors)) {
        if (message) ctx.addIssue({ code: 'custom', message, path: [field] });
      }
    });
}

/**
 * Step one of the password reset: just an address to mail a code to.
 *
 * Deliberately does not check that the address is registered — the server
 * will not say either, so there is nothing to check against and pretending
 * otherwise would be the enumeration leak the endpoint exists to avoid.
 */
export function validateForgotPasswordEmail(email: string): FieldErrors<ForgotPasswordField> {
  const errors: FieldErrors<ForgotPasswordField> = {};
  const trimmed = email.trim();

  if (!trimmed) errors.email = 'กรุณากรอกอีเมล';
  else if (!isValidEmail(trimmed)) errors.email = 'รูปแบบอีเมลไม่ถูกต้อง';

  return errors;
}

/**
 * Step two: the code and the new password go up together, so a mistake in
 * either one costs the same round trip. Catching the cheap ones here matters
 * more than usual — a rejected request does **not** invalidate the code, but
 * `TOO_MANY_ATTEMPTS` counts every wrong OTP the server sees.
 */
export function validateResetPassword(values: {
  otp: string;
  password: string;
  confirmPassword: string;
}): FieldErrors<ResetPasswordField> {
  const errors: FieldErrors<ResetPasswordField> = {};

  if (!values.otp) errors.otp = 'กรุณากรอกรหัสยืนยัน';
  else if (!/^\d{6}$/.test(values.otp)) errors.otp = 'รหัสยืนยันต้องเป็นตัวเลข 6 หลัก';

  if (!values.password) errors.password = 'กรุณากรอกรหัสผ่านใหม่';
  else if (values.password.length < PASSWORD_MIN)
    errors.password = `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`;

  if (!values.confirmPassword) errors.confirmPassword = 'กรุณายืนยันรหัสผ่าน';
  else if (values.confirmPassword !== values.password)
    errors.confirmPassword = 'รหัสผ่านไม่ตรงกัน';

  return errors;
}

export const hasErrors = (errors: FieldErrors<string>): boolean =>
  Object.keys(errors).length > 0;
