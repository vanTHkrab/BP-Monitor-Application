/**
 * Naming and rendering the five health fields for a non-technical reader.
 *
 * The audit trail is the reason this file exists. `ProfileChangeLog` stores
 * what changed as three raw strings — `"weight"`, `"60"`, `"80"` — because
 * the five fields span four types and typed columns would mean four nullable
 * pairs of which three are always null. Raw is the right storage and the
 * wrong thing to show someone: "gender: male → female" is a database row, and
 * the person reading it is an elderly patient checking what a relative did to
 * their record. Turning those strings back into "เพศ · ชาย → หญิง" is this
 * file's whole job, and it has to agree with the edit form or the log stops
 * being evidence.
 *
 * Gender labels and the Thai date format come from `modules/profile` rather
 * than being restated — see `modules/profile/lib/display.ts` for why they
 * moved there. Deep import, matching the precedent in
 * `modules/profile/lib/validation.ts`: the barrel rule exists to stop screens
 * skipping the hooks' cache invalidation, which does not apply between two
 * pure lib files, and `@/modules/profile`'s barrel reaches an image picker
 * through `use-profile-avatar`.
 */
import { parseIsoDate } from '@/utils/date-formatter';

import type { Gender } from '../../auth/types';
import { formatBirthday, genderLabel } from '../../profile/lib/display';
import type { HealthFieldName } from '../types';

const HEALTH_FIELD_LABELS: Record<HealthFieldName, string> = {
  dob: 'วันเกิด',
  gender: 'เพศ',
  weight: 'น้ำหนัก',
  height: 'ส่วนสูง',
  congenitalDisease: 'โรคประจำตัว',
};

/**
 * Falls back to the raw column name for a field this client does not know.
 *
 * A newer gateway could log a sixth field, and the honest failure for a
 * screen whose purpose is oversight is "something called `bloodType`
 * changed", not a placeholder that hides it. See
 * `profileChangeLogEntryFromGql`, which passes `field` through for this.
 */
export function healthFieldLabel(field: HealthFieldName | string): string {
  return HEALTH_FIELD_LABELS[field as HealthFieldName] ?? field;
}

/** What an empty side of a change reads as. Not "—": this is a sentence about a person. */
export const HEALTH_VALUE_EMPTY = 'ยังไม่ได้ระบุ';

/**
 * One stored audit value, rendered the way the edit form shows the same
 * column.
 *
 * `dob` arrives as `YYYY-MM-DD` (the gateway renders it with
 * `toISOString().slice(0, 10)`), so it is parsed as a *local* midnight before
 * formatting — `new Date('1950-03-01')` is UTC midnight, which in Bangkok is
 * still the 1st but in any negative-offset zone is the 28th of February. The
 * log is the one screen where showing a different day than was saved would be
 * indistinguishable from the caregiver having saved the wrong day.
 *
 * Anything unparseable falls through to the raw string rather than to the
 * empty placeholder: a value that is present but odd must not read as absent.
 */
export function formatHealthValue(
  field: HealthFieldName | string,
  value?: string | null,
): string {
  if (value === undefined || value === null || value.trim() === '') {
    return HEALTH_VALUE_EMPTY;
  }

  switch (field) {
    case 'dob': {
      const parsed = parseIsoDate(value);
      return parsed ? formatBirthday(parsed) : value;
    }
    case 'gender':
      // Cast, then fall back to the raw string: `genderLabel` returns `''`
      // for anything outside the three known values, and a stored gender this
      // client does not recognise is still a change the patient must see.
      return genderLabel(value as Gender) || value;
    case 'weight':
      return `${value} กก.`;
    case 'height':
      return `${value} ซม.`;
    default:
      return value;
  }
}
