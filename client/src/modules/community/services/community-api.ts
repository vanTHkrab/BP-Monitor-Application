/**
 * The gateway side of the community feed. I/O only — it calls, maps, and
 * returns; it does not touch the cache and it does not format errors.
 */
import { pagination } from '@/config';
import { graphqlRequest } from '@/services/api';

import {
  commentFromGql,
  postFromGql,
  type CommentPayload,
  type PostPayload,
} from '../lib/mappers';
import type { Comment, CreatePostInput, Post, PostCategory, UpdatePostInput } from '../types';
import {
  GQL_CREATE_COMMENT,
  GQL_CREATE_POST,
  GQL_DELETE_COMMENT,
  GQL_DELETE_POST,
  GQL_POSTS,
  GQL_POST_COMMENTS,
  GQL_TOGGLE_COMMENT_LIKE,
  GQL_TOGGLE_LIKE,
  GQL_UPDATE_COMMENT,
  GQL_UPDATE_POST,
} from './operations';

/**
 * One page is the whole feed today. The gateway takes `limit`/`offset` and
 * this tree does not paginate yet — when it does, this is the seam, and the
 * cache key in `use-posts.ts` has to grow a page component in the same change.
 */
export const POSTS_PAGE_SIZE = pagination.postsPageSize;

export async function fetchPosts(category?: PostCategory): Promise<Post[]> {
  const data = await graphqlRequest<{ posts: PostPayload[] }>(GQL_POSTS, {
    category: category ?? null,
    limit: POSTS_PAGE_SIZE,
    offset: 0,
  });
  return data.posts.map(postFromGql);
}

export async function createPost(input: CreatePostInput): Promise<Post> {
  const data = await graphqlRequest<{ createPost: PostPayload }>(GQL_CREATE_POST, {
    input: { content: input.content, category: input.category },
  });
  return postFromGql(data.createPost);
}

export async function updatePost(input: UpdatePostInput): Promise<boolean> {
  const data = await graphqlRequest<{ updatePost: boolean }>(GQL_UPDATE_POST, {
    input: { id: input.id, content: input.content, category: input.category },
  });
  return data.updatePost;
}

export async function deletePost(id: number): Promise<boolean> {
  const data = await graphqlRequest<{ deletePost: boolean }>(GQL_DELETE_POST, { id });
  return data.deletePost;
}

/** Resolves to the post's *new* liked state. */
export async function toggleLike(postId: number): Promise<boolean> {
  const data = await graphqlRequest<{ toggleLike: boolean }>(GQL_TOGGLE_LIKE, { postId });
  return data.toggleLike;
}

export async function fetchPostComments(postId: number): Promise<Comment[]> {
  const data = await graphqlRequest<{ postComments: CommentPayload[] }>(GQL_POST_COMMENTS, {
    postId,
  });
  return data.postComments.map(commentFromGql);
}

export async function createComment(postId: number, content: string): Promise<Comment> {
  const data = await graphqlRequest<{ createComment: CommentPayload }>(GQL_CREATE_COMMENT, {
    input: { postId, content },
  });
  return commentFromGql(data.createComment);
}

export async function updateComment(id: number, content: string): Promise<Comment> {
  const data = await graphqlRequest<{ updateComment: CommentPayload }>(GQL_UPDATE_COMMENT, {
    input: { id, content },
  });
  return commentFromGql(data.updateComment);
}

export async function deleteComment(id: number): Promise<boolean> {
  const data = await graphqlRequest<{ deleteComment: boolean }>(GQL_DELETE_COMMENT, { id });
  return data.deleteComment;
}

/** Resolves to the comment's *new* liked state. */
export async function toggleCommentLike(commentId: number): Promise<boolean> {
  const data = await graphqlRequest<{ toggleCommentLike: boolean }>(GQL_TOGGLE_COMMENT_LIKE, {
    commentId,
  });
  return data.toggleCommentLike;
}
