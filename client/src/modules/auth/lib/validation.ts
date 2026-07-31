/**
 * Client-side form validation for the auth screens.
 *
 * Pure, and deliberately *not* a mirror of the gateway's rules. The server
 * validates for correctness; this validates to save a round trip on mistakes
 * the user can see for themselves. Where the two disagree, the server wins —
 * so nothing here may be stricter than `RegisterInput`'s class-validator
 * decorators, or a legitimate account becomes unreachable from the app.
 *
 * Returns a map of field → Thai message. Empty means "nothing obviously
 * wrong", not "the server will accept this".
 */
import { stripPhoneDigits } from '@/utils/phone-format';
import type { RegisterInput } from '../types';

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export type LoginField = 'phone' | 'password';
export type RegisterField = LoginField | 'firstname' | 'lastname' | 'email' | 'confirmPassword';

/** Matches the gateway's `PASSWORD_MIN`. */
export const PASSWORD_MIN = 8;

/**
 * Accepts 9 or 10 digits. The gateway's `PHONE_REGEX` is the real gate; this
 * only catches the obvious cases before a request goes out.
 */
export const isValidPhone = (digits: string): boolean => /^\d{9,10}$/.test(digits);

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
  else if (!isValidPhone(phone)) errors.phone = 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก';

  if (!input.password) errors.password = 'กรุณากรอกรหัสผ่าน';

  return errors;
}

export type RegisterFormValues = Pick<
  RegisterInput,
  'firstname' | 'lastname' | 'phone' | 'password' | 'email'
> & { confirmPassword: string };

export function validateRegister(values: RegisterFormValues): FieldErrors<RegisterField> {
  const errors: FieldErrors<RegisterField> = {};
  const phone = stripPhoneDigits(values.phone);

  if (!values.firstname.trim()) errors.firstname = 'กรุณากรอกชื่อ';
  if (!values.lastname.trim()) errors.lastname = 'กรุณากรอกนามสกุล';

  if (!phone) errors.phone = 'กรุณากรอกเบอร์โทรศัพท์';
  else if (!isValidPhone(phone)) errors.phone = 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9-10 หลัก';

  // Required since the Better Auth migration — it was optional before, and a
  // registration without one is now rejected before it reaches the resolver.
  if (!values.email.trim()) errors.email = 'กรุณากรอกอีเมล';
  else if (!isValidEmail(values.email.trim())) errors.email = 'รูปแบบอีเมลไม่ถูกต้อง';

  if (!values.password) errors.password = 'กรุณากรอกรหัสผ่าน';
  else if (values.password.length < PASSWORD_MIN)
    errors.password = `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`;

  if (!values.confirmPassword) errors.confirmPassword = 'กรุณายืนยันรหัสผ่าน';
  else if (values.confirmPassword !== values.password)
    errors.confirmPassword = 'รหัสผ่านไม่ตรงกัน';

  return errors;
}

export const hasErrors = (errors: FieldErrors<string>): boolean =>
  Object.keys(errors).length > 0;
