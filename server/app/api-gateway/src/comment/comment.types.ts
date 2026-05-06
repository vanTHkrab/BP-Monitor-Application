import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';

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
  @Field(() => Int) postId: number;
  @Field() content: string;
  @Field(() => Int, { nullable: true }) parentId?: number;
}

@InputType()
export class UpdateCommentInput {
  @Field(() => Int) id: number;
  @Field() content: string;
}
