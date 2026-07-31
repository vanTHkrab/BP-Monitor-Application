import { Field, ID, InputType } from '@nestjs/graphql';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class RenamePasskeyInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  name: string;
}
