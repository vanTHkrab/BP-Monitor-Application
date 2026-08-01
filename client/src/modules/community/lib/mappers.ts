/**
 * GraphQL payloads → domain types.
 *
 * Same split as the other modules: dates become `Date` here and nowhere else,
 * and `null` becomes `undefined` so the rest of the module uses one empty
 * value instead of two.
 */
import { parseCategory } from './categories';
import type { Comment, Post } from '../types';

export type PostPayload = {
  id: number;
  userId: string;
  userName: string;
  userAvatar: string | null;
  content: string;
  category: string;
  likes: number;
  comments: number;
  isLiked: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type CommentPayload = {
  id: number;
  postId: number;
  userId: string;
  userName: string;
  userAvatar: string | null;
  content: string;
  likes: number;
  replies: number;
  isLiked: boolean;
  parentId: number | null;
  createdAt: string;
  updatedAt: string | null;
};

export function postFromGql(payload: PostPayload): Post {
  return {
    id: payload.id,
    userId: payload.userId,
    userName: payload.userName,
    userAvatar: payload.userAvatar ?? undefined,
    content: payload.content,
    category: parseCategory(payload.category),
    likes: payload.likes,
    comments: payload.comments,
    isLiked: payload.isLiked,
    createdAt: new Date(payload.createdAt),
    updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : undefined,
  };
}

export function commentFromGql(payload: CommentPayload): Comment {
  return {
    id: payload.id,
    postId: payload.postId,
    userId: payload.userId,
    userName: payload.userName,
    userAvatar: payload.userAvatar ?? undefined,
    content: payload.content,
    likes: payload.likes,
    replies: payload.replies,
    isLiked: payload.isLiked,
    parentId: payload.parentId ?? undefined,
    createdAt: new Date(payload.createdAt),
    updatedAt: payload.updatedAt ? new Date(payload.updatedAt) : undefined,
  };
}
