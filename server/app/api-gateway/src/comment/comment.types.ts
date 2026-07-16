import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// PostComment.content is @db.Text (no hard DB limit) with no client-side cap,
// so this is an application-level abuse ceiling. 2000 mirrors the existing
// reading.notes convention — comments are shorter replies than posts.
const COMMENT_CONTENT_MAX = 2000;

@ObjectType()
export class CommentType {
  @Field(() => Int) id: number;
  @Field(() => Int) postId: number;
  @Field() userId: string;
  @Field(() => Int, { nullable: true }) parentId?: number;
  @Field() userName: string;
  @Field({ nullable: true }) userAvatar?: string;
  @Field() content: string;
  @Field(() => Int) likes: number;
  @Field(() => Int) replies: number;
  @Field() isLiked: boolean;
  @Field() createdAt: Date;
  @Field({ nullable: true }) updatedAt?: Date;
}

@InputType()
export class CreateCommentInput {
  // Every field needs a class-validator decorator alongside @Field — the
  // global ValidationPipe runs with `whitelist: true` + `forbidNonWhitelisted:
  // true`, so any property without a validator decorator is treated as
  // non-whitelisted and 400s the request before it reaches the resolver.
  @Field(() => Int)
  @IsInt()
  postId: number;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMMENT_CONTENT_MAX)
  content: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  parentId?: number;
}

@InputType()
export class UpdateCommentInput {
  @Field(() => Int)
  @IsInt()
  id: number;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMMENT_CONTENT_MAX)
  content: string;
}
