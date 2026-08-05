import { Field, Float, ObjectType, registerEnumType } from '@nestjs/graphql';

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
  @Field(() => Float, { nullable: true }) weight?: number;
  @Field(() => Float, { nullable: true }) height?: number;
}
