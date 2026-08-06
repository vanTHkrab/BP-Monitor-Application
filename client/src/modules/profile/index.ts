/**
 * Public surface of the profile module. Screens import from here, never from
 * a file inside — same rule as `modules/auth`, `modules/security`, and
 * `modules/caregivers`.
 *
 * There is no `services/` here: the profile write is `updateProfile`, which
 * belongs to `modules/auth` because that is where the `me` query lives and
 * whoever mutates a query has to refresh it. This module owns the form —
 * its shape, its validation, and the diff that decides what is worth sending.
 */
export { useProfileAvatar, type AvatarSource } from './hooks/use-profile-avatar';

export { changedFields, formFromUser, hasChanges } from './lib/form-state';
/*
 * Vocabulary, not a form. `modules/caregivers` writes the same five health
 * columns from `app/patient-health.tsx` and reads them back in
 * `app/profile-changes.tsx`; it reaches these by path rather than through
 * this barrel (which drags an image picker in behind `use-profile-avatar`),
 * but the profile screen imports them from here like everything else.
 */
export { GENDER_OPTIONS, formatBirthday, genderLabel } from './lib/display';
export {
  validateProfile,
  validateDob,
  validateMeasurement,
  CONGENITAL_DISEASE_MAX,
  HEIGHT_RANGE_CM,
  MAX_AGE_YEARS,
  WEIGHT_RANGE_KG,
  type ProfileErrors,
} from './lib/validation';

export { DateField } from './components/date-field';
export { ProfileField, ProfileGroup, ProfileLinkRow } from './components/profile-field';
export { ProfileHero } from './components/profile-hero';

export type { ProfileField as ProfileFieldName, ProfileForm } from './types';
