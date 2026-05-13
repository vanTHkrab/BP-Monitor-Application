import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class AlertReadingType {
  @Field(() => Int) id: number;
  @Field(() => Int) systolic: number;
  @Field(() => Int) diastolic: number;
  @Field(() => Int) pulse: number;
  @Field() status: string;
  @Field() measuredAt: Date;
  @Field({ nullable: true }) imageUri?: string;
}

@ObjectType()
export class AlertType {
  @Field(() => Int) id: number;
  @Field() userId: string;
  @Field(() => Int) bpReadingId: number;
  @Field() alertMessage: string;
  @Field() alertLevel: string;
  @Field() isRead: boolean;
  @Field() createdAt: Date;
  @Field(() => AlertReadingType, { nullable: true })
  reading?: AlertReadingType;
}
