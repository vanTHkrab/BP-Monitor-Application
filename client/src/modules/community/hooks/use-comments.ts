/**
 * One post's comments, and the four things that change them.
 *
 * Flat, not threaded. `parentId` exists on the schema and on the type, but
 * client-old never rendered a reply and neither does this — turning it on is
 * a feature, not part of a port.
 *
 * Every mutation that changes the *count* also patches the post's `comments`
 * field wherever it is cached. Otherwise the feed card behind the detail
 * route keeps showing the old number until a refetch, and the two screens
 * disagree about the same post while both are on screen.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { applyLikeResult, toggleLike, updateById } from '../lib/likes';
import * as communityApi from '../services/community-api';
import type { Comment, Post } from '../types';

const commentsKey = (postId: number) => ['comments', postId] as const;
const postsRootKey = ['posts'] as const;
const postKey = (id: number) => ['post', id] as const;

/** Keeps the card's comment count honest against the list being edited. */
function shiftCommentCount(queryClient: QueryClient, postId: number, delta: number) {
  const bump = (post: Post): Post => ({
    ...post,
    comments: Math.max(0, post.comments + delta),
  });

  queryClient.setQueriesData<Post[]>({ queryKey: postsRootKey }, (posts) =>
    posts ? updateById(posts, postId, bump) : posts,
  );
  queryClient.setQueryData<Post>(postKey(postId), (post) => (post ? bump(post) : post));
}

export function usePostComments(postId: number) {
  const query = useQuery<Comment[]>({
    queryKey: commentsKey(postId),
    queryFn: () => communityApi.fetchPostComments(postId),
    enabled: Number.isFinite(postId),
  });

  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useCreateComment(postId: number) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (content: string) => communityApi.createComment(postId, content),
    onSuccess: (comment) => {
      // Appended, not prepended: a comment thread reads top-down, and the
      // newest reply belongs at the bottom where the composer is.
      queryClient.setQueryData<Comment[]>(commentsKey(postId), (comments) =>
        comments ? [...comments, comment] : [comment],
      );
      shiftCommentCount(queryClient, postId, 1);
    },
  });

  return {
    createComment: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

export function useUpdateComment(postId: number) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, content }: { id: number; content: string }) =>
      communityApi.updateComment(id, content),
    onSuccess: (updated) => {
      queryClient.setQueryData<Comment[]>(commentsKey(postId), (comments) =>
        comments ? updateById(comments, updated.id, () => updated) : comments,
      );
    },
  });

  return {
    updateComment: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

export function useDeleteComment(postId: number) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: number) => communityApi.deleteComment(id),
    onSuccess: (_ok, id) => {
      queryClient.setQueryData<Comment[]>(commentsKey(postId), (comments) =>
        comments?.filter((comment) => comment.id !== id),
      );
      shiftCommentCount(queryClient, postId, -1);
    },
  });

  return {
    deleteComment: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/** Optimistic for the same reason `useToggleLike` is — see the note there. */
export function useToggleCommentLike(postId: number) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (commentId: number) => communityApi.toggleCommentLike(commentId),

    onMutate: async (commentId) => {
      await queryClient.cancelQueries({ queryKey: commentsKey(postId) });
      const previous = queryClient.getQueryData<Comment[]>(commentsKey(postId));

      queryClient.setQueryData<Comment[]>(commentsKey(postId), (comments) =>
        comments ? updateById(comments, commentId, toggleLike) : comments,
      );

      return { previous };
    },

    onError: (_error, _commentId, context) => {
      if (context?.previous) queryClient.setQueryData(commentsKey(postId), context.previous);
    },

    onSuccess: (isLiked, commentId) => {
      queryClient.setQueryData<Comment[]>(commentsKey(postId), (comments) =>
        comments
          ? updateById(comments, commentId, (comment) => applyLikeResult(comment, isLiked))
          : comments,
      );
    },
  });

  return { toggleCommentLike: mutation.mutate, error: mutation.error };
}
