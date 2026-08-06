/**
 * How the health columns are *named* in Thai, in one place.
 *
 * Extracted from `app/profile.tsx` when a caregiver gained a second screen
 * that writes the same five columns (`app/patient-health.tsx`) and a third
 * that reads them back (`app/profile-changes.tsx`). Three copies of
 * `{ male: 'ชาย', … }` is three chances for a patient to be told "เพศ: ชาย"
 * on one screen and something else on the log that is supposed to be the
 * record of what happened — which is the one place a mismatch is not a
 * cosmetic bug.
 *
 * Vocabulary only. The *form* stays in `app/profile.tsx`, and deliberately
 * so: that form also carries `firstname`, `lastname`, `phone` and the avatar,
 * none of which a caregiver may touch. Sharing the component rather than the
 * words is how those fields would come back within reach.
 */
import type { Gender } from '@/modules/auth';

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'ชาย' },
  { value: 'female', label: 'หญิง' },
  { value: 'other', label: 'อื่น ๆ' },
];

/** Empty string for "not set" — callers render their own placeholder. */
export const genderLabel = (gender?: Gender | null): string =>
  GENDER_OPTIONS.find((option) => option.value === gender)?.label ?? '';

/**
 * A birthday, in the form a Thai reader expects (Buddhist era via the `th-TH`
 * locale). Empty string when unset, matching `genderLabel`.
 *
 * Deliberately **not** `utils/thai-date.ts`'s `formatThaiDate`, and named
 * apart from it so the two never get confused. That one is the short
 * `"1 มี.ค. 2493"` used for reading timestamps, where a list of dates has to
 * stay narrow. A birthday appears once, in a form, next to the control that
 * sets it — the long month is easier to read at a glance and this is an
 * elderly-first audience. The Buddhist era is the same in both.
 */
export const formatBirthday = (date?: Date | null): string =>
  date
    ? date.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
