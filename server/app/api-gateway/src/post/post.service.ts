import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PostCategory } from '../prisma/generated/enums';

@Injectable()
export class PostService {
  constructor(private readonly prisma: PrismaService) {}

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

    return posts.map((p) => ({
      id: p.id,
      userId: p.userId,
      clientId: p.clientId ?? undefined,
      userName: `${p.user.firstname} ${p.user.lastname}`.trim(),
      userAvatar: p.user.avatar ?? undefined,
      content: p.content,
      category: p.category,
      likes: p._count.likes,
      comments: p._count.comments,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt ?? undefined,
      isLiked: currentUserId
        ? p.likes.some((l) => l.userId === currentUserId)
        : false,
    }));
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
        return existing;
      }
    }

    return this.prisma.post.create({
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

    return this.prisma.post.update({
      where: { id: postId },
      data: patch,
      include: {
        user: {
          select: { id: true, firstname: true, lastname: true, avatar: true },
        },
        _count: { select: { likes: true, comments: true } },
      },
    });
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
}
