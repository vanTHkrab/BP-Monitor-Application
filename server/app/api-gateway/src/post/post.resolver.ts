import { UseGuards } from '@nestjs/common';
import {
  Args,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import { GqlAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PostService } from './post.service';

@ObjectType()
export class PostType {
  @Field(() => Int) id: number;
  @Field() userId: string;
  @Field({ nullable: true }) clientId?: string;
  @Field() userName: string;
  @Field({ nullable: true }) userAvatar?: string;
  @Field() content: string;
  @Field() category: string;
  @Field(() => Int) likes: number;
  @Field() createdAt: Date;
  @Field({ nullable: true }) updatedAt?: Date;
  @Field() isLiked: boolean;
}

@InputType()
export class CreatePostInput {
  @Field() content: string;
  @Field() category: string;
  @Field({ nullable: true }) clientId?: string;
}

@InputType()
export class UpdatePostInput {
  @Field(() => Int) id: number;
  @Field({ nullable: true }) content?: string;
  @Field({ nullable: true }) category?: string;
}

@Resolver()
export class PostResolver {
  constructor(private readonly postService: PostService) {}

  @Query(() => [PostType], { description: 'รายการโพสต์ชุมชน (สาธารณะ)' })
  async posts(
    @Args('category', { nullable: true }) category?: string,
    @Args('limit', { type: () => Int, defaultValue: 100 }) limit?: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset?: number,
  ): Promise<PostType[]> {
    return this.postService.list(category || null, limit!, offset!);
  }

  @Mutation(() => PostType, { description: 'สร้างโพสต์ใหม่' })
  @UseGuards(GqlAuthGuard)
  async createPost(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreatePostInput,
  ): Promise<PostType> {
    const p = await this.postService.create(user.id, input);
    return {
      id: p.id,
      userId: p.userId,
      clientId: p.clientId ?? undefined,
      userName: `${p.user.firstname} ${p.user.lastname}`.trim(),
      userAvatar: p.user.avatar ?? undefined,
      content: p.content,
      category: p.category,
      likes: p._count.likes,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt ?? undefined,
      isLiked: false,
    };
  }

  @Mutation(() => Boolean, { description: 'แก้ไขโพสต์' })
  @UseGuards(GqlAuthGuard)
  async updatePost(
    @CurrentUser() user: { id: string },
    @Args('input') input: UpdatePostInput,
  ): Promise<boolean> {
    const result = await this.postService.update(user.id, input.id, input);
    return result !== null;
  }

  @Mutation(() => Boolean, { description: 'ลบโพสต์' })
  @UseGuards(GqlAuthGuard)
  async deletePost(
    @CurrentUser() user: { id: string },
    @Args('id', { type: () => Int }) id: number,
  ): Promise<boolean> {
    return this.postService.delete(user.id, id);
  }

  @Mutation(() => Boolean, { description: 'กดถูกใจ/ยกเลิกถูกใจโพสต์' })
  @UseGuards(GqlAuthGuard)
  async toggleLike(
    @CurrentUser() user: { id: string },
    @Args('postId', { type: () => Int }) postId: number,
  ): Promise<boolean> {
    return this.postService.toggleLike(user.id, postId);
  }
}
