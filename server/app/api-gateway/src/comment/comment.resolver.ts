import { UseGuards } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import {
  getOptionalCurrentUser,
  type GraphQLContextLike,
} from '../auth/helpers/optional-current-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CommentService } from './comment.service';
import {
  CommentType,
  CreateCommentInput,
  UpdateCommentInput,
} from './comment.types';

@Resolver(() => CommentType)
export class CommentResolver {
  constructor(
    private readonly commentService: CommentService,
    private readonly prisma: PrismaService,
  ) {}

  @Query(() => [CommentType], { description: 'รายการความคิดเห็นของโพสต์' })
  async postComments(
    @Args('postId', { type: () => Int }) postId: number,
    @Args('parentId', { type: () => Int, nullable: true }) parentId: number,
    @Context() context: GraphQLContextLike,
  ): Promise<CommentType[]> {
    const currentUser = await getOptionalCurrentUser(context, this.prisma);
    return this.commentService.list(postId, parentId ?? null, currentUser?.id);
  }

  @Mutation(() => CommentType, { description: 'สร้างความคิดเห็นใหม่' })
  @UseGuards(GqlAuthGuard)
  async createComment(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateCommentInput,
  ): Promise<CommentType> {
    return this.commentService.create(user.id, input, user.id);
  }

  @Mutation(() => CommentType, { description: 'แก้ไขความคิดเห็น' })
  @UseGuards(GqlAuthGuard)
  async updateComment(
    @CurrentUser() user: { id: string },
    @Args('input') input: UpdateCommentInput,
  ): Promise<CommentType> {
    return this.commentService.update(
      user.id,
      input.id,
      input.content,
      user.id,
    );
  }

  @Mutation(() => Boolean, { description: 'ลบความคิดเห็น' })
  @UseGuards(GqlAuthGuard)
  async deleteComment(
    @CurrentUser() user: { id: string },
    @Args('id', { type: () => Int }) id: number,
  ): Promise<boolean> {
    return this.commentService.delete(user.id, id);
  }

  @Mutation(() => Boolean, { description: 'กดถูกใจ/ยกเลิกถูกใจความคิดเห็น' })
  @UseGuards(GqlAuthGuard)
  async toggleCommentLike(
    @CurrentUser() user: { id: string },
    @Args('commentId', { type: () => Int }) commentId: number,
  ): Promise<boolean> {
    return this.commentService.toggleLike(user.id, commentId);
  }
}
