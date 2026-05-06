import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommentType } from './comment.types';

type CommentWithCounts = {
  id: number;
  postId: number;
  userId: string;
  parentId: number | null;
  content: string;
  createdAt: Date;
  updatedAt: Date | null;
  user: {
    firstname: string;
    lastname: string;
    avatar: string | null;
  };
  likes: Array<{ userId: string }>;
  _count: {
    likes: number;
    replies: number;
  };
};

@Injectable()
export class CommentService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    postId: number,
    parentId: number | null,
    currentUserId?: string,
  ): Promise<CommentType[]> {
    const rows = await this.prisma.postComment.findMany({
      where: {
        postId,
        parentId,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { firstname: true, lastname: true, avatar: true } },
        likes: { select: { userId: true } },
        _count: { select: { likes: true, replies: true } },
      },
    });

    return rows.map((comment) => this.toCommentType(comment, currentUserId));
  }

  async create(
    userId: string,
    data: { postId: number; content: string; parentId?: number },
    currentUserId?: string,
  ): Promise<CommentType> {
    const content = data.content.trim();
    if (!content) {
      throw new BadRequestException('กรุณาพิมพ์ความคิดเห็นก่อนส่ง');
    }

    const post = await this.prisma.post.findUnique({
      where: { id: data.postId },
      select: { id: true },
    });

    if (!post) {
      throw new NotFoundException('ไม่พบโพสต์นี้');
    }

    if (data.parentId) {
      const parent = await this.prisma.postComment.findUnique({
        where: { id: data.parentId },
        select: { postId: true },
      });

      if (!parent || parent.postId !== data.postId) {
        throw new BadRequestException('ความคิดเห็นต้นทางไม่ถูกต้อง');
      }
    }

    const comment = await this.prisma.postComment.create({
      data: {
        postId: data.postId,
        userId,
        parentId: data.parentId ?? null,
        content,
      },
      include: {
        user: { select: { firstname: true, lastname: true, avatar: true } },
        likes: { select: { userId: true } },
        _count: { select: { likes: true, replies: true } },
      },
    });

    return this.toCommentType(comment, currentUserId ?? userId);
  }

  async update(
    userId: string,
    id: number,
    content: string,
    currentUserId?: string,
  ): Promise<CommentType> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new BadRequestException('กรุณาพิมพ์ความคิดเห็นก่อนบันทึก');
    }

    const existing = await this.prisma.postComment.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing) {
      throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('แก้ไขได้เฉพาะความคิดเห็นของตัวเอง');
    }

    const comment = await this.prisma.postComment.update({
      where: { id },
      data: {
        content: trimmed,
        updatedAt: new Date(),
      },
      include: {
        user: { select: { firstname: true, lastname: true, avatar: true } },
        likes: { select: { userId: true } },
        _count: { select: { likes: true, replies: true } },
      },
    });

    return this.toCommentType(comment, currentUserId ?? userId);
  }

  async delete(userId: string, id: number): Promise<boolean> {
    const existing = await this.prisma.postComment.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing) {
      return false;
    }

    if (existing.userId !== userId) {
      throw new ForbiddenException('ลบได้เฉพาะความคิดเห็นของตัวเอง');
    }

    await this.prisma.postComment.delete({ where: { id } });
    return true;
  }

  async toggleLike(userId: string, commentId: number): Promise<boolean> {
    const comment = await this.prisma.postComment.findUnique({
      where: { id: commentId },
      select: { id: true },
    });

    if (!comment) {
      throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    }

    const existing = await this.prisma.postCommentLike.findUnique({
      where: { userId_commentId: { userId, commentId } },
    });

    if (existing) {
      await this.prisma.postCommentLike.delete({
        where: { userId_commentId: { userId, commentId } },
      });
      return false;
    }

    await this.prisma.postCommentLike.create({
      data: { userId, commentId },
    });
    return true;
  }

  private toCommentType(
    comment: CommentWithCounts,
    currentUserId?: string,
  ): CommentType {
    return {
      id: comment.id,
      postId: comment.postId,
      userId: comment.userId,
      parentId: comment.parentId ?? undefined,
      userName: `${comment.user.firstname} ${comment.user.lastname}`.trim(),
      userAvatar: comment.user.avatar ?? undefined,
      content: comment.content,
      likes: comment._count.likes,
      replies: comment._count.replies,
      isLiked: currentUserId
        ? comment.likes.some((like) => like.userId === currentUserId)
        : false,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt ?? undefined,
    };
  }
}
