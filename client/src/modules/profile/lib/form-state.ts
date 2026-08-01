/**
 * `User` ⇄ form, and the diff between them.
 *
 * The diff is the load-bearing part. `updateProfile` is a partial update, and
 * the gateway treats a present-but-empty value as "clear this column"
 * (`data.dob !== undefined` → `patch.dob = data.dob || null`). Sending the
 * whole form on every save therefore rewrites every column with what the
 * screen happened to be holding — which quietly reverts anything another
 * device changed since this screen loaded, and, for `phone`, re-runs a
 * uniqueness check against a value that did not change.
 *
 * So: send only what the user actually touched.
 */
import type { UpdateProfileInput, User } from '@/modules/auth';
import { formatIsoDate } from '@/utils/date-formatter';
import { stripPhoneDigits } from '@/utils/phone-format';

import type { ProfileForm } from '../types';

/** Same day, ignoring time — `dob` has no meaningful time component. */
const sameDay = (a: Date | null, b: Date | null): boolean => {
  if (a === null || b === null) return a === b;
  return a.toDateString() === b.toDateString();
};

/** `''` and `undefined` both mean "no value" for a text column. */
const sameText = (formValue: string, userValue: string | undefined): boolean =>
  formValue.trim() === (userValue ?? '').trim();

/**
 * Compares as numbers, not as strings: "70" and "70.0" are the same weight,
 * and re-sending one because the user retyped it is a write with no change.
 */
const sameNumber = (formValue: string, userValue: number | undefined): boolean => {
  const trimmed = formValue.trim();
  if (!trimmed) return userValue === undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed === userValue;
};

export function formFromUser(user: User | null): ProfileForm {
  return {
    firstname: user?.firstname ?? '',
    lastname: user?.lastname ?? '',
    phone: user?.phone ?? '',
    dob: user?.dob ?? null,
    gender: user?.gender ?? null,
    weight: user?.weight != null ? String(user.weight) : '',
    height: user?.height != null ? String(user.height) : '',
    congenitalDisease: user?.congenitalDisease ?? '',
  };
}

/**
 * Only the fields that differ from `user`. Returns an empty object when
 * nothing changed, which the screen uses to skip the request entirely rather
 * than show a success message for a write that did nothing.
 *
 * `email` is deliberately absent — see the header of `app/profile.tsx`.
 */
export function changedFields(form: ProfileForm, user: User | null): UpdateProfileInput {
  const patch: UpdateProfileInput = {};

  if (!sameText(form.firstname, user?.firstname)) patch.firstname = form.firstname.trim();
  if (!sameText(form.lastname, user?.lastname)) patch.lastname = form.lastname.trim();

  const phoneDigits = stripPhoneDigits(form.phone);
  if (phoneDigits !== stripPhoneDigits(user?.phone ?? '')) patch.phone = phoneDigits;

  // `null`, never `undefined`, for the cleared cases below. `undefined` does
  // not survive JSON serialisation, so it would reach the gateway as an
  // absent key — which means "leave this column alone", the opposite of what
  // clearing a field asks for. See `authApi.updateProfile`.
  if (!sameDay(form.dob, user?.dob ?? null)) {
    // `YYYY-MM-DD`, not a full ISO instant. A birthday is a calendar day, and
    // `toISOString()` on the picker's local midnight shifts it to the previous
    // day in UTC — which round-trips back correctly, but stores a date nobody
    // reading the database would recognise. See `utils/date-formatter.ts`.
    patch.dob = form.dob ? formatIsoDate(form.dob) : null;
  }

  if ((form.gender ?? null) !== (user?.gender ?? null)) {
    patch.gender = form.gender;
  }

  if (!sameNumber(form.weight, user?.weight)) {
    const trimmed = form.weight.trim();
    patch.weight = trimmed ? Number(trimmed) : null;
  }

  if (!sameNumber(form.height, user?.height)) {
    const trimmed = form.height.trim();
    patch.height = trimmed ? Number(trimmed) : null;
  }

  if (!sameText(form.congenitalDisease, user?.congenitalDisease)) {
    patch.congenitalDisease = form.congenitalDisease.trim() || null;
  }

  return patch;
}

export const hasChanges = (patch: UpdateProfileInput): boolean =>
  Object.keys(patch).length > 0;
