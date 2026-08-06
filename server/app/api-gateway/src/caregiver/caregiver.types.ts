import {
  Field,
  Float,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  IsDate,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum CaregiverLinkStatusGql {
  pending = 'pending',
  accepted = 'accepted',
  rejected = 'rejected',
}

registerEnumType(CaregiverLinkStatusGql, {
  name: 'CaregiverLinkStatus',
  description: 'สถานะของคำเชิญ caregiver–patient',
});

export enum CaregiverPermissionGql {
  view = 'view',
  full = 'full',
}

/**
 * What an accepted link permits. Mirrors Prisma's `CaregiverPermission`.
 *
 * An **enum rather than a String**, unlike `relationship`. That field parses
 * an unknown value down to `other` (see `parseRelationship`), which is
 * tolerable for a label but not for this: silently reading an unrecognised
 * permission as anything at all decides who may write into a medical record.
 * As an enum the wrong value fails GraphQL validation before the resolver
 * runs, so there is no fallback to get wrong.
 */
registerEnumType(CaregiverPermissionGql, {
  name: 'CaregiverPermission',
  description:
    'สิทธิ์ที่ผู้ป่วยให้ผู้ดูแล — view: ดูอย่างเดียว, full: บันทึกค่าความดันแทนได้ และแก้ไขข้อมูลสุขภาพ (วันเกิด เพศ น้ำหนัก ส่วนสูง โรคประจำตัว) ได้',
});

@ObjectType()
export class CaregiverLinkType {
  @Field() caregiverId: string;
  @Field() patientId: string;
  @Field() relationship: string;
  @Field() caregiverName: string;
  @Field() caregiverPhone: string;
  /**
   * Both avatars ride along on the link.
   *
   * The link is symmetric — the same row is "my caregiver" to one side and
   * "my patient" to the other — so the client cannot know in advance which
   * person a given row is *about*. Returning one `avatar` would mean the
   * resolver guessing the viewer's side; returning both lets the caller pick,
   * and costs nothing: `User.avatar` is already in the rows this query joins.
   *
   * `myPatients` carries the patient's avatar separately for the caregiver's
   * own list. This is the only source for the *caregiver's* face, which the
   * patient sees on the invite card and in their caregiver list.
   */
  @Field({ nullable: true }) caregiverAvatar?: string;
  @Field() patientName: string;
  @Field() patientPhone: string;
  @Field({ nullable: true }) patientAvatar?: string;
  @Field(() => CaregiverLinkStatusGql) status: CaregiverLinkStatusGql;
  @Field({ nullable: true }) respondedAt?: Date;
  /**
   * What this link permits — meaningful only once `status` is `accepted`.
   *
   * The patient is the one who grants it and was the one person who could not
   * see it: `PatientSummaryType.permission` shows a caregiver their own
   * access, but that query is caregiver-only, so the patient's link list had
   * no way to display the decision they had made. A grant nobody can read is
   * a grant nobody will revoke.
   *
   * A `pending` row carries the column default rather than a decision — the
   * patient has not answered yet. Clients should not render it until the
   * status is `accepted`.
   *
   * Typed as the enum, unlike `PatientSummaryType.permission`, which is a
   * `String!` that predates `CaregiverPermission` being registered. Both
   * serialise identically, so the client parses either; aligning that one is
   * worth doing on its own rather than as a side effect here.
   */
  @Field(() => CaregiverPermissionGql) permission: CaregiverPermissionGql;
}

/** Just enough of a reading to sort and colour a patient row. */
@ObjectType()
export class PatientLatestReadingType {
  @Field(() => Int) systolic: number;
  @Field(() => Int) diastolic: number;
  @Field(() => Int) pulse: number;
  @Field() status: string;
  @Field() measuredAt: Date;
}

@ObjectType()
export class PatientSummaryType {
  @Field() id: string;
  @Field() firstname: string;
  @Field() lastname: string;
  @Field() phone: string;
  @Field({ nullable: true }) avatar?: string;
  @Field({ nullable: true }) dob?: Date;
  @Field({ nullable: true }) relationship?: string;
  /**
   * `view` or `full` — what this caregiver's accepted link permits.
   *
   * Exposed so the client can refuse a write before making it. The gateway
   * refuses it either way (`assertCanRecordForPatient`), but a camera that
   * lets someone frame, capture, and confirm a reading before telling them
   * they were never allowed to save it has wasted the one measurement they
   * took.
   */
  @Field() permission: string;
  /**
   * The patient's most recent reading, or absent if they have never recorded
   * one.
   *
   * Embedded rather than left to the caller because the alternative is one
   * `readings(patientId:)` round trip per patient — a caregiver with five
   * patients pays five requests to answer "who needs attention", which is the
   * only question a patient list is opened to answer. One extra grouped query
   * here replaces N.
   */
  @Field(() => PatientLatestReadingType, { nullable: true })
  latestReading?: PatientLatestReadingType;
  @Field(() => Float, { nullable: true }) weight?: number;
  @Field(() => Float, { nullable: true }) height?: number;
  /**
   * `gender` and `congenitalDisease` are here for one reason: they are two of
   * the five fields `updatePatientHealth` lets a `full` caregiver write, and
   * this is the only query that shows a caregiver their patient's values.
   *
   * Without them the edit form could not seed those two, so saving would
   * either send `null` for both on every submit — erasing a condition nobody
   * was shown — or the client would need a special case to suppress fields it
   * cannot display. **The editable set and the readable set have to match.**
   * If a sixth field ever becomes editable, it belongs here in the same
   * change.
   */
  @Field({ nullable: true }) gender?: string;
  @Field({ nullable: true }) congenitalDisease?: string;
}

/**
 * The five health fields a `full` caregiver may edit on their patient.
 *
 * **Deliberately not an extension of `UpdateProfileInput`.** That input also
 * carries `email`, `phone`, `firstname`, `lastname` and `avatar`. Sharing it
 * and filtering the unwanted keys in the service would leave the caregiver
 * path one forgotten `if` away from writing a login identity: `email` and
 * `phone` are both `@unique` and both Better Auth sign-in identifiers, so a
 * caregiver who could change the email could then request a password reset
 * and take the account outright. A separate type makes that reachability
 * question answerable by reading the type, not by auditing the service.
 *
 * `firstname` / `lastname` / `avatar` are excluded for a weaker but real
 * reason: they are how other people identify the patient, not health data.
 *
 * Absent and null mean different things, as in `updateProfile`. A field left
 * out is untouched; a field sent as `null` is cleared. `@IsOptional()` skips
 * validation for both, so clearing does not have to satisfy `@Min`.
 *
 * `gender` is a validated `String` rather than a GraphQL enum, matching
 * `UpdateProfileInput.gender` and `UserObject.gender`. `@IsIn` constrains it
 * exactly as tightly as `@IsEnum` would. Registering a `Gender` enum for this
 * one input would put two representations of the same field in the schema —
 * the same asymmetry `PatientSummaryType.permission` already documents, and
 * worth fixing on its own rather than as a side effect here.
 */
@InputType()
export class UpdatePatientHealthInput {
  // Every field states its GraphQL type explicitly. The `| null` in the TS
  // type — which is what lets a caller clear a field — erases to `Object`
  // under `emitDecoratorMetadata`, so the inferred form Nest uses elsewhere
  // fails at schema build with "Undefined type error". This is a boot-time
  // failure, not a type error: `tsc --noEmit` passes either way.
  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  dob?: Date | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: string | null;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(500)
  weight?: number | null;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(280)
  height?: number | null;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  congenitalDisease?: string | null;
}

/**
 * What the edit mutation returns: the patient's health fields after the write.
 *
 * A narrow type rather than `UserObject` on purpose — the caregiver asked to
 * change five fields and gets those five back. Returning the full user object
 * from a caregiver-invoked mutation would hand back `email` and `phone`,
 * widening what this path discloses beyond what it was authorised to change.
 */
@ObjectType()
export class PatientHealthProfileType {
  @Field() patientId: string;
  @Field({ nullable: true }) dob?: Date;
  @Field({ nullable: true }) gender?: string;
  @Field(() => Float, { nullable: true }) weight?: number;
  @Field(() => Float, { nullable: true }) height?: number;
  @Field({ nullable: true }) congenitalDisease?: string;
}

/**
 * One recorded change to one health field. Mirrors `ProfileChangeLog`.
 *
 * `actorId` is nullable because the actor's account may have been deleted
 * since; `actorName` is a snapshot taken at write time and is always present,
 * so the trail can still say who acted.
 */
@ObjectType()
export class ProfileChangeLogType {
  @Field() id: string;
  @Field({ nullable: true }) actorId?: string;
  @Field() actorName: string;
  /** True when the patient made this edit themselves. */
  @Field() byPatient: boolean;
  @Field() field: string;
  @Field({ nullable: true }) oldValue?: string;
  @Field({ nullable: true }) newValue?: string;
  @Field() changedAt: Date;
}
