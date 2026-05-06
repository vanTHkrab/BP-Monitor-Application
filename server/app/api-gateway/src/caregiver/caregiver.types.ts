import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class CaregiverLinkType {
  @Field() caregiverId: string;
  @Field() patientId: string;
  @Field() relationship: string;
  @Field() caregiverName: string;
  @Field() caregiverPhone: string;
  @Field() patientName: string;
  @Field() patientPhone: string;
}
