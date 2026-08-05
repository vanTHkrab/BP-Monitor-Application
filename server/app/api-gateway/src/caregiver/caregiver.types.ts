import {
  Field,
  Float,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';

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
  description: 'สิทธิ์ที่ผู้ป่วยให้ผู้ดูแล — view: ดูอย่างเดียว, full: บันทึกแทนได้',
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
}
