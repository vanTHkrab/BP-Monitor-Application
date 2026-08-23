import { Gender } from '../prisma/generated/enums';

/**
 * Shared vocabulary for the `user_informations` health block.
 *
 * Lives beside the auth module because `users` and `UserObject` do, and it is
 * imported by `caregiver.service.ts` as well — the caregiver edit path and the
 * patient's own profile path write the same row through the same rules, and
 * having each restate them is how the two drift apart.
 *
 * Everything here is a pure function or a type. No DI, no Prisma client.
 */

/** The five fields the row carries, in the order the audit trail lists them. */
export const HEALTH_FIELDS = [
  'dob',
  'gender',
  'weight',
  'height',
  'congenitalDisease',
] as const;

export type HealthField = (typeof HEALTH_FIELDS)[number];

/**
 * The four columns that are NOT NULL on `user_informations`.
 *
 * The row's *existence* is what carries "the patient has provided their health
 * information", so these four have to be present for a row to exist at all —
 * which is why they can be set and changed but never cleared. See
 * `CANNOT_CLEAR_MESSAGE`.
 */
export const REQUIRED_HEALTH_FIELDS = [
  'dob',
  'gender',
  'weight',
  'height',
] as const;

export type RequiredHealthField = (typeof REQUIRED_HEALTH_FIELDS)[number];

const REQUIRED_HEALTH_FIELD_SET: ReadonlySet<string> = new Set(
  REQUIRED_HEALTH_FIELDS,
);

export const isRequiredHealthField = (
  field: HealthField,
): field is RequiredHealthField => REQUIRED_HEALTH_FIELD_SET.has(field);

/** The health block as it comes back from Prisma. `null` means no row. */
export type UserInformationRow = {
  dob: Date;
  gender: Gender;
  weight: number;
  height: number;
  congenitalDisease: string | null;
};

/**
 * A partial write to the row.
 *
 * Deliberately not `Record<string, unknown>`. The previous shape of this patch
 * was exactly that, which is why the old `patch.dob = data.dob || null` lines
 * type-checked cleanly against a column that had stopped accepting null — the
 * compiler had nothing to check them against. Typed like this, a write that
 * the schema cannot represent is a build error.
 */
export type HealthPatch = {
  dob?: Date;
  gender?: Gender;
  weight?: number;
  height?: number;
  congenitalDisease?: string | null;
};

/** Anything one of the five fields can arrive as, on either side of the wire. */
export type HealthValue = Date | number | string | null | undefined;

/**
 * Narrows a wire value onto the typed patch.
 *
 * The four required fields must already have been checked for null by the
 * caller — this converts, it does not validate. `gender` is the one cast, and
 * it is safe because every entry point constrains the string with `@IsIn`
 * before it gets here.
 */
export const applyHealthValue = (
  patch: HealthPatch,
  field: HealthField,
  value: HealthValue,
): void => {
  switch (field) {
    case 'dob':
      patch.dob = value instanceof Date ? value : new Date(String(value));
      break;
    case 'gender':
      patch.gender = String(value) as Gender;
      break;
    case 'weight':
      patch.weight = Number(value);
      break;
    case 'height':
      patch.height = Number(value);
      break;
    case 'congenitalDisease':
      patch.congenitalDisease =
        value === null || value === undefined ? null : String(value);
      break;
  }
};

/**
 * The `create` half of a `userInformation.upsert`, or `null` when the four
 * required values are not available between the existing row and the patch.
 *
 * `null` is not an error here — it is the answer to "can this partial edit
 * bring a row into existence?", and the caller decides what a `no` means. Both
 * current callers turn it into a 400, but registration could equally decide to
 * skip the write, and does.
 */
export const buildInformationCreate = (
  existing: UserInformationRow | null,
  patch: HealthPatch,
): UserInformationRow | null => {
  const dob = patch.dob ?? existing?.dob;
  const gender = patch.gender ?? existing?.gender;
  const weight = patch.weight ?? existing?.weight;
  const height = patch.height ?? existing?.height;

  if (
    dob === undefined ||
    gender === undefined ||
    weight === undefined ||
    height === undefined
  ) {
    return null;
  }

  return {
    dob,
    gender,
    weight,
    height,
    congenitalDisease:
      patch.congenitalDisease !== undefined
        ? patch.congenitalDisease
        : (existing?.congenitalDisease ?? null),
  };
};

/**
 * What the GraphQL layer renders for `congenitalDisease`.
 *
 * The product decision is that the question is asked as มี / ไม่มี, so "no
 * condition" is an *answered* state and has to read back as an answer rather
 * than as an empty field. The column stores NULL for it — see the
 * `UserInformation` docstring in schema.prisma for why the string must never
 * be written there — so the substitution happens here, at the boundary where
 * the row becomes a GraphQL object, and nowhere else.
 *
 * Three states survive the mapping intact:
 *
 * | row            | column | GraphQL   | means                     |
 * | -------------- | ------ | --------- | ------------------------- |
 * | absent         | —      | `null`    | health step not completed |
 * | present        | NULL   | `'ไม่มี'` | answered: no condition    |
 * | present        | text   | that text | answered: that condition  |
 *
 * There is deliberately no inverse on the write path. A user who types `ไม่มี`
 * into the text box has it stored verbatim, and it renders identically to the
 * NULL case — which is harmless, because the two remain distinguishable in the
 * column. Mapping it back to NULL on write is what would make them
 * indistinguishable, permanently.
 */
export const NO_CONGENITAL_DISEASE = 'ไม่มี';

export const presentCongenitalDisease = (
  information: { congenitalDisease: string | null } | null | undefined,
): string | undefined => {
  if (!information) return undefined;
  return information.congenitalDisease ?? NO_CONGENITAL_DISEASE;
};

/** User-facing (Thai, per root rule 7). */
export const INCOMPLETE_HEALTH_MESSAGE =
  'ข้อมูลสุขภาพยังไม่ครบ กรุณาระบุวันเกิด เพศ น้ำหนัก และส่วนสูงให้ครบถ้วน';

const FIELD_LABELS: Record<RequiredHealthField, string> = {
  dob: 'วันเกิด',
  gender: 'เพศ',
  weight: 'น้ำหนัก',
  height: 'ส่วนสูง',
};

export const cannotClearMessage = (field: RequiredHealthField): string =>
  `ไม่สามารถลบข้อมูล${FIELD_LABELS[field]}ได้ กรุณาระบุค่าใหม่แทน`;
