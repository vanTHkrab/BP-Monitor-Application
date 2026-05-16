import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostCategory } from '../prisma/generated/enums';
import { StorageService } from '../storage/storage.service';

type PostWithIncludes = {
  id: number;
  userId: string;
  clientId: string | null;
  content: string;
  category: string;
  createdAt: Date;
  updatedAt: Date | null;
  user: {
    id: string;
    firstname: string;
    lastname: string;
    avatar: string | null;
  };
  likes?: Array<{ userId: string }>;
  _count: { likes: number; comments: number };
};

@Injectable()
export class PostService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(
    category: string | null,
    limit: number,
    offset: number,
    currentUserId?: string,
  ) {
    const where = category ? { category: category as PostCategory } : {};

    const posts = await this.prisma.post.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: {
        user: {
          select: { id: true, firstname: true, lastname: true, avatar: true },
        },
        likes: { select: { userId: true } },
        _count: { select: { likes: true, comments: true } },
      },
    });

    return Promise.all(posts.map((p) => this.toPostShape(p, currentUserId)));
  }

  async create(
    userId: string,
    data: { content: string; category: string; clientId?: string },
  ) {
    if (data.clientId) {
      const existing = await this.prisma.post.findUnique({
        where: { clientId: data.clientId },
        include: {
          user: {
            select: { id: true, firstname: true, lastname: true, avatar: true },
          },
          _count: { select: { likes: true, comments: true } },
        },
      });

      if (existing && existing.userId === userId) {
        return this.toPostShape(existing, userId);
      }
    }

    const created = await this.prisma.post.create({
      data: {
        userId,
        content: data.content.trim(),
        category: data.category as PostCategory,
        clientId: data.clientId || null,
      },
      include: {
        user: {
          select: { id: true, firstname: true, lastname: true, avatar: true },
        },
        _count: { select: { likes: true, comments: true } },
      },
    });

    return this.toPostShape(created, userId);
  }

  async update(
    userId: string,
    postId: number,
    data: { content?: string; category?: string },
  ) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.userId !== userId) return null;

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (data.content) patch.content = data.content;
    if (data.category) patch.category = data.category;

    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: patch,
      include: {
        user: {
          select: { id: true, firstname: true, lastname: true, avatar: true },
        },
        _count: { select: { likes: true, comments: true } },
      },
    });

    return this.toPostShape(updated, userId);
  }

  async delete(userId: string, postId: number) {
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.userId !== userId) return false;
    await this.prisma.post.delete({ where: { id: postId } });
    return true;
  }

  async toggleLike(userId: string, postId: number): Promise<boolean> {
    const existing = await this.prisma.postLike.findUnique({
      where: { userId_postId: { userId, postId } },
    });

    if (existing) {
      await this.prisma.postLike.delete({
        where: { userId_postId: { userId, postId } },
      });
      return false; // unliked
    }

    await this.prisma.postLike.create({
      data: { userId, postId },
    });
    return true; // liked
  }

  private async toPostShape(p: PostWithIncludes, currentUserId?: string) {
    const userAvatar = await this.storage.signImageKey(p.user.avatar);
    return {
      id: p.id,
      userId: p.userId,
      clientId: p.clientId ?? undefined,
      userName: `${p.user.firstname} ${p.user.lastname}`.trim(),
      userAvatar: userAvatar ?? undefined,
      content: p.content,
      category: p.category,
      likes: p._count.likes,
      comments: p._count.comments,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt ?? undefined,
      isLiked: currentUserId
        ? (p.likes ?? []).some((l) => l.userId === currentUserId)
        : false,
    };
  }
}
