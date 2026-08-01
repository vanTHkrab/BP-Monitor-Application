/**
 * Profile-editing types.
 *
 * The form is all-strings on purpose. A `TextInput` produces a string, and
 * "the user cleared the weight field" and "the user has not typed a weight"
 * are the same empty string — converting to `number | undefined` at every
 * keystroke would lose that and make backspacing the last digit snap the
 * field back to its old value. Conversion happens once, in
 * `lib/form-state.ts`, on the way out.
 */
import type { Gender } from '@/modules/auth';

export type ProfileField =
  | 'firstname'
  | 'lastname'
  | 'phone'
  | 'dob'
  | 'gender'
  | 'weight'
  | 'height'
  | 'congenitalDisease';

export type ProfileForm = {
  firstname: string;
  lastname: string;
  /** Display-formatted; stripped to digits before it is sent. */
  phone: string;
  /** `null` means "not set" — the gateway accepts clearing it. */
  dob: Date | null;
  gender: Gender | null;
  weight: string;
  height: string;
  congenitalDisease: string;
};
