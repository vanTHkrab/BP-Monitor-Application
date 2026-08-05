import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class AlertReadingType {
  @Field(() => Int) id: number;
  /**
   * Who the reading belongs to.
   *
   * Not the same as `AlertType.userId`, which is the *recipient*. They differ
   * exactly when this alert reached a caregiver through the fan-out in
   * `ReadingService.createAlertForReading` — which is what lets the client
   * mark those rows as being about somebody else without a second query.
   */
  @Field() userId: string;
  @Field(() => Int) systolic: number;
  @Field(() => Int) diastolic: number;
  @Field(() => Int) pulse: number;
  @Field() status: string;
  @Field() measuredAt: Date;
  @Field({ nullable: true }) s3Key?: string;
}

@ObjectType()
export class AlertType {
  @Field(() => Int) id: number;
  @Field() userId: string;
  @Field(() => Int) bpReadingId: number;
  @Field() alertMessage: string;
  @Field() alertLevel: string;
  @Field({ nullable: true }) readAt?: Date;
  @Field() createdAt: Date;
  @Field(() => AlertReadingType, { nullable: true })
  reading?: AlertReadingType;
}
