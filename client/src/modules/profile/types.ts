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
import type { CongenitalAnswer } from '@/lib/health-validation';
import type { Gender } from '@/modules/auth';

export type ProfileField =
  | 'firstname'
  | 'lastname'
  | 'phone'
  | 'dob'
  | 'gender'
  | 'weight'
  | 'height'
  | 'congenital'
  | 'congenitalDisease';

export type ProfileForm = {
  firstname: string;
  lastname: string;
  /** Display-formatted; stripped to digits before it is sent. */
  phone: string;
  /**
   * `null` means "not set". The gateway no longer accepts *clearing* it —
   * `dob` is `NOT NULL` on `user_informations` — so `null` is only reachable
   * for a record that never had a health block. See `validateHealthBlock`.
   */
  dob: Date | null;
  gender: Gender | null;
  weight: string;
  height: string;
  /**
   * มี / ไม่มี, or `null` for "not answered yet".
   *
   * The question is two controls now, and the split is the point: the gateway
   * stores "no condition" as a NULL `congenitalDisease` and renders it back as
   * the string `'ไม่มี'`, so "answered: none" and "never asked" have to stay
   * distinguishable on this side too. A single text box collapses them — an
   * empty one could mean either, which is exactly the ambiguity that stopped
   * the other four health columns from being `NOT NULL`.
   */
  congenital: CongenitalAnswer | null;
  /** Free text, and only meaningful while `congenital` is `'has'`. */
  congenitalDisease: string;
};
