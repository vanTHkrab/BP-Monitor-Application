import { UseGuards } from '@nestjs/common';
import {
  Args,
  Context,
  Field,
  InputType,
  Int,
  Mutation,
  ObjectType,
  Query,
  Resolver,
} from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GqlAuthGuard } from '../auth/auth.guard';
import {
  getOptionalCurrentUser,
  type GraphQLContextLike,
} from '../auth/helpers/optional-current-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { PostCategory } from '../prisma/generated/enums';
import { PrismaService } from '../prisma/prisma.service';
import { PostService } from './post.service';

// Post.content is @db.Text (no hard DB limit) and there is no client-side cap,
// so this is an application-level abuse ceiling. 5000 gives long-form
// experience/QA posts headroom (~2.5x the reading.notes convention of 2000).
const POST_CONTENT_MAX = 5000;

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
  @Field(() => Int) comments: number;
  @Field() createdAt: Date;
  @Field({ nullable: true }) updatedAt?: Date;
  @Field() isLiked: boolean;
}

@InputType()
export class CreatePostInput {
  // Every field needs a class-validator decorator alongside @Field — the
  // global ValidationPipe runs with `whitelist: true` + `forbidNonWhitelisted:
  // true`, so any property without a validator decorator is treated as
  // non-whitelisted and 400s the request before it reaches the resolver.
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_CONTENT_MAX)
  content: string;

  @Field()
  @IsEnum(PostCategory)
  category: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  clientId?: string;
}

@InputType()
export class UpdatePostInput {
  @Field(() => Int)
  @IsInt()
  id: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(POST_CONTENT_MAX)
  content?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsEnum(PostCategory)
  category?: string;
}

@Resolver()
export class PostResolver {
  constructor(
    private readonly postService: PostService,
    private readonly prisma: PrismaService,
  ) {}

  @Query(() => [PostType], { description: 'รายการโพสต์ชุมชน (สาธารณะ)' })
  async posts(
    @Args('category', { nullable: true }) category?: string,
    @Args('limit', { type: () => Int, defaultValue: 100 }) limit?: number,
    @Args('offset', { type: () => Int, defaultValue: 0 }) offset?: number,
    @Context() context?: GraphQLContextLike,
  ): Promise<PostType[]> {
    const currentUser = await getOptionalCurrentUser(context, this.prisma);
    return this.postService.list(
      category || null,
      limit!,
      offset!,
      currentUser?.id,
    );
  }

  @Mutation(() => PostType, { description: 'สร้างโพสต์ใหม่' })
  @UseGuards(GqlAuthGuard)
  async createPost(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreatePostInput,
  ): Promise<PostType> {
    return this.postService.create(user.id, input);
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
