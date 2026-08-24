/**
 * Plausibility bounds for the health columns, and the validators that read them.
 *
 * Neutral by design. Three modules write these same columns — `modules/auth`
 * at sign-up, `modules/profile` from the patient's own edit form, and
 * `modules/caregivers` when someone edits on the patient's behalf — and a
 * bound only one of them enforces produces a value that form then refuses to
 * re-save. A 10 kg weight accepted at sign-up and rejected by the profile
 * screen leaves the user stuck with a number they cannot correct.
 *
 * It lives outside all three rather than inside one of them because
 * `modules/profile/lib/validation.ts` already imports `isValidPhone` from
 * `modules/auth/lib/validation.ts`. Having auth import the measurement rules
 * back from profile would close a cycle between two modules — fragile under
 * Jest even where ESM tolerates it. This file imports nothing, so nothing can
 * cycle through it.
 *
 * The bounds are plausibility checks, not medical ones. They exist to catch a
 * slipped decimal point ("1750" cm) before a round trip, not to tell anyone
 * their body is out of range.
 *
 * They are **exactly the gateway's own** `@Min` / `@Max` (weight 1–500,
 * height 30–280, both on `RegisterInput` and `UpdateProfileInput`) — not a
 * narrower client-side guess. An earlier version of this file used a tighter
 * range (20–300 / 50–250) specifically so a client check would never be
 * *looser* than a plausibility judgement profile wanted to make. That was
 * reversed: this file's own rule is that nothing here may be stricter than
 * the gateway on a column the server would otherwise accept, and a narrower
 * client range broke that rule the same way the old `{9,10}` phone regex did
 * — a value the server would store silently became one the app refused to
 * save. See `modules/auth/lib/validation.ts`'s docblock for the account-vs-
 * non-account distinction that rule turns on.
 *
 * One real thing is given up by widening rather than keeping the tighter
 * range: catching a slipped decimal / stray zero depends on the typo'd value
 * landing outside the range, and a wider range is a smaller target. The named
 * case above still lands cleanly outside either range no matter which one is
 * in force — 1750 cm and 1750 kg are absurd at 250/300 *and* at 280/500. What
 * stops being caught is narrower: a true weight in roughly 31–50 kg, typo'd
 * with one extra trailing zero (310–500), no longer exceeds the new 500 kg
 * ceiling the way it exceeded the old 300 kg one. That gap is accepted, not
 * overlooked — it is the cost of matching the server exactly, and the
 * alternative (keeping the old ceiling) is the violation this rewrite exists
 * to remove.
 *
 * Messages are Thai because they surface to the user.
 */

export const WEIGHT_RANGE_KG = { min: 1, max: 500 } as const;
export const HEIGHT_RANGE_CM = { min: 30, max: 280 } as const;
/** Matches the gateway's column exactly; a longer note is truncated server-side. */
export const CONGENITAL_DISEASE_MAX = 500;
/** Nobody alive was born earlier, and a typo'd year is the real target. */
export const MAX_AGE_YEARS = 120;

/**
 * Empty is valid — every field using this is optional. Returns a Thai message
 * if the value is present and implausible.
 */
export function validateMeasurement(
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

/**
 * A birthday one form accepts and another refuses is a bug the patient meets
 * only when someone edits on their behalf, so all three forms run this one.
 */
export function validateDob(dob: Date | null, now: Date = new Date()): string | null {
  if (!dob) return null;

  const oldest = new Date(now);
  oldest.setFullYear(oldest.getFullYear() - MAX_AGE_YEARS);

  if (dob.getTime() > now.getTime()) return 'วันเกิดต้องไม่เป็นวันในอนาคต';
  if (dob.getTime() < oldest.getTime()) return 'กรุณาตรวจสอบปีเกิดอีกครั้ง';

  return null;
}

/**
 * Length only — the column takes free text and the gateway stores whatever
 * fits. Trimmed first, so trailing whitespace cannot push a note over the
 * limit that the server would have accepted after its own trim.
 */
export function validateCongenitalDisease(raw: string): string | null {
  if (raw.trim().length > CONGENITAL_DISEASE_MAX) {
    return `กรอกได้ไม่เกิน ${CONGENITAL_DISEASE_MAX} ตัวอักษร`;
  }

  return null;
}

/* ------------------------------------------------------------------------ *
 * The required health block, and the two-part congenital-disease answer.
 *
 * Added when the gateway moved these five columns into `user_informations`.
 * Both halves below exist because the *server* changed shape, so both mirror
 * a specific thing in `server/app/api-gateway/src/auth/user-information.ts`
 * and have to move with it:
 *
 *   - `dob` / `gender` / `weight` / `height` are `NOT NULL` there, and the
 *     row's *existence* is what records "the patient completed the health
 *     step". Clearing any of the four is now a 400 (`cannotClearMessage`),
 *     and a partial edit that cannot bring the row into existence is a 400
 *     too (`INCOMPLETE_HEALTH_MESSAGE`). Both are deliberate: dropping the
 *     clear silently would return 200 with the old value still in place.
 *   - `congenitalDisease` stays nullable, because NULL there is an *answer*
 *     ("no condition") rather than a gap — which is the only reason the
 *     other four could become `NOT NULL` at all. The gateway renders that
 *     NULL as the string `'ไม่มี'` at the DTO boundary.
 *
 * The forms therefore have to stop offering a clear the server will refuse,
 * and have to ask the congenital question as a two-part answer rather than a
 * free-text box that means nothing when empty.
 * ------------------------------------------------------------------------ */

/**
 * The four the gateway cannot store as NULL.
 *
 * A strict subset of these is **unrepresentable**: the row is created by an
 * upsert that needs all four, so a record either has the whole block or has
 * no row at all. Every rule below leans on that — `hasHealthRecord` asks the
 * question once rather than per field.
 */
export const REQUIRED_HEALTH_FIELDS = ['dob', 'gender', 'weight', 'height'] as const;

export type RequiredHealthField = (typeof REQUIRED_HEALTH_FIELDS)[number];

/**
 * What the gateway sends for a row whose `congenitalDisease` column is NULL
 * (`presentCongenitalDisease`). Read back as "answered: no condition".
 *
 * The inverse is deliberately **not** applied on the write path there, so a
 * user who types `ไม่มี` into the text box has it stored verbatim and it
 * renders identically. That is harmless and this side matches it: such a
 * value seeds the form as the "ไม่มี" answer, and re-saving it produces no
 * diff either way.
 */
export const NO_CONGENITAL_DISEASE = 'ไม่มี';

/** The select's answer. `null` is "not answered yet", which is a real state. */
export type CongenitalAnswer = 'has' | 'none';

export const CONGENITAL_OPTIONS = [
  { value: 'has', label: 'มี' },
  { value: 'none', label: 'ไม่มี' },
] as const satisfies readonly { value: CongenitalAnswer; label: string }[];

/**
 * Does this record carry a health row at all?
 *
 * `undefined` for the four means the patient has never completed the health
 * step — a Google sign-up starts there, and so does any account the
 * `user_informations` migration could not backfill.
 */
export const hasHealthRecord = (record: {
  dob?: Date | null;
  gender?: string | null;
  weight?: number | null;
  height?: number | null;
}): boolean =>
  record.dob != null &&
  record.gender != null &&
  record.weight != null &&
  record.height != null;

/** Seed the select from what the gateway sent. */
export const congenitalAnswerFrom = (
  recorded: string | undefined,
): CongenitalAnswer | null => {
  if (recorded === undefined) return null;
  return recorded.trim() === NO_CONGENITAL_DISEASE ? 'none' : 'has';
};

/** Seed the text box. Empty for "ไม่มี" — the answer is in the select. */
export const congenitalTextFrom = (recorded: string | undefined): string =>
  congenitalAnswerFrom(recorded) === 'has' ? (recorded ?? '') : '';

/**
 * The two form controls as one string, in the gateway's own rendering, so a
 * diff can compare like with like.
 *
 * Without this the round trip is not stable: the gateway sends `'ไม่มี'`, the
 * form holds `answer: 'none'` + empty text, and a naive comparison against
 * the empty text reports a change on every save — a write, and a row in the
 * patient's audit trail, for an edit nobody made.
 */
export const renderCongenital = (
  answer: CongenitalAnswer | null,
  text: string,
): string | undefined => {
  if (answer === null) return undefined;
  return answer === 'none' ? NO_CONGENITAL_DISEASE : text.trim();
};

/**
 * What goes on the wire. `null` clears the column, which is how "ไม่มี" is
 * stored — see `NO_CONGENITAL_DISEASE`. `undefined` means the question is
 * unanswered and the key must not be sent at all.
 */
export const congenitalWireValue = (
  answer: CongenitalAnswer | null,
  text: string,
): string | null | undefined => {
  if (answer === null) return undefined;
  if (answer === 'none') return null;
  return text.trim() || null;
};

/** Mirrors the gateway's `FIELD_LABELS`. Thai, because it reaches the user. */
const REQUIRED_FIELD_LABELS: Record<RequiredHealthField, string> = {
  dob: 'วันเกิด',
  gender: 'เพศ',
  weight: 'น้ำหนัก',
  height: 'ส่วนสูง',
};

/**
 * Word-for-word the gateway's `cannotClearMessage`, not merely its meaning.
 *
 * Both sides can reject the same clear — this one first, the gateway if the
 * baseline this form was seeded from is stale — and a user who reaches the
 * second after the first should not be told the same thing in different
 * words. The two strings had already drifted; if `auth/user-information.ts`
 * changes, change this with it.
 */
export const cannotClearMessage = (field: RequiredHealthField): string =>
  `ไม่สามารถลบข้อมูล${REQUIRED_FIELD_LABELS[field]}ได้ กรุณาระบุค่าใหม่แทน`;

/**
 * Per-field "please fill this in". Shared with the register form so the three
 * screens that write these columns cannot word the same demand differently.
 */
export const REQUIRED_HEALTH_MESSAGES: Record<RequiredHealthField, string> = {
  dob: 'กรุณาเลือกวันเกิด',
  gender: 'กรุณาเลือกเพศ',
  weight: 'กรุณากรอกน้ำหนัก',
  height: 'กรุณากรอกส่วนสูง',
};

export const ANSWER_CONGENITAL_MESSAGE = 'กรุณาระบุว่ามีโรคประจำตัวหรือไม่';
export const DESCRIBE_CONGENITAL_MESSAGE = 'กรุณาระบุโรคประจำตัว';

export type HealthBlockValues = {
  dob: Date | null;
  gender: string | null;
  weight: string;
  height: string;
  congenital: CongenitalAnswer | null;
  congenitalDisease: string;
};

export type HealthBlockField = RequiredHealthField | 'congenital' | 'congenitalDisease';

export type HealthBlockErrors = Partial<Record<HealthBlockField, string>>;

/**
 * The presence rules for the block, as one function all three forms run.
 *
 * It answers a single question — *may this form be submitted as it stands* —
 * and it answers it the way the gateway would:
 *
 *   - A record that already has the block must keep all four. An emptied
 *     field is a clear, and a clear is a 400, so it is refused here with the
 *     server's own wording rather than sent and bounced.
 *   - A record without the block may leave the whole thing empty (the patch
 *     then carries no health key and the gateway never looks), but the moment
 *     *any* part of it is filled in, all four are required — a partial patch
 *     cannot create the row, and the gateway returns
 *     `INCOMPLETE_HEALTH_MESSAGE` rather than a half-built row.
 *   - The congenital question counts as "filled in" for that test, because
 *     the profile path's `touched` flag counts it (`auth.service.ts`):
 *     sending only `congenitalDisease` against a missing row is the same 400.
 *     The caregiver path is *softer*, not equal — it diffs rendered values
 *     and early-returns, so the same request is a silent no-op there. This
 *     rule refuses on both, deliberately: a save that succeeds by doing
 *     nothing is worse than one that says why it cannot.
 *   - `required` short-circuits the "may be left alone" case for the one form
 *     that has no such case: registration *creates* the row, so all four have
 *     to be there. It is separate from `recorded` because the two answer
 *     different questions — `recorded` picks the wording ("ลบไม่ได้" for a
 *     value being erased, "กรุณากรอก" for one never given), and a blank
 *     register form is not erasing anything.
 *
 * It is presence only. The plausibility bounds above are separate and every
 * caller still runs both — a value that is present and absurd fails there.
 */
export function validateHealthBlock(
  values: HealthBlockValues,
  { recorded, required = false }: { recorded: boolean; required?: boolean },
): HealthBlockErrors {
  const present: Record<RequiredHealthField, boolean> = {
    dob: values.dob !== null,
    gender: Boolean(values.gender),
    weight: Boolean(values.weight.trim()),
    height: Boolean(values.height.trim()),
  };

  const answered = values.congenital !== null;
  const touched =
    answered || REQUIRED_HEALTH_FIELDS.some((field) => present[field]);

  if (!required && !recorded && !touched) return {};

  const errors: HealthBlockErrors = {};

  for (const field of REQUIRED_HEALTH_FIELDS) {
    if (present[field]) continue;
    // The distinction is worth the branch: "ลบไม่ได้" tells someone who just
    // emptied a box that the box may not be empty, while "กรุณากรอก" tells
    // someone completing the block for the first time what is still missing.
    errors[field] = recorded
      ? cannotClearMessage(field)
      : REQUIRED_HEALTH_MESSAGES[field];
  }

  if (!answered) {
    errors.congenital = ANSWER_CONGENITAL_MESSAGE;
  } else if (values.congenital === 'has' && !values.congenitalDisease.trim()) {
    errors.congenitalDisease = DESCRIBE_CONGENITAL_MESSAGE;
  }

  return errors;
}
