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

@ObjectType()
export class CaregiverLinkType {
  @Field() caregiverId: string;
  @Field() patientId: string;
  @Field() relationship: string;
  @Field() caregiverName: string;
  @Field() caregiverPhone: string;
  @Field() patientName: string;
  @Field() patientPhone: string;
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
