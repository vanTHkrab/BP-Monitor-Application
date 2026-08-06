import { Field, InputType } from '@nestjs/graphql';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

@InputType()
export class RegisterPushTokenInput {
  /**
   * The `ExponentPushToken[…]` string from `getExpoPushTokenAsync()`.
   *
   * Only length-checked here. The format itself is validated in the service
   * with `Expo.isExpoPushToken`, because the SDK is the authority on what
   * Expo will accept and a hand-written regex here would be a second,
   * silently divergent copy of that rule.
   */
  @Field()
  @IsString()
  @MaxLength(255)
  token: string;

  /** What the user sees in a device list, e.g. "Pixel 8". */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceLabel?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsIn(['ios', 'android'])
  platform?: string;
}
