/**
 * The feed's read and the four things that change it.
 *
 * Network-only, by the boundary `services/query-client.ts` draws: community
 * has no SQLite mirror, so this cache is the only copy and there is nothing
 * for it to be stale against. client-old queued posts offline through
 * `pending_posts`; porting that would mean adding a table, a sync mutex, and
 * a local→remote id remap, and contradicting a decision this tree already
 * wrote down. A post composed offline fails loudly here instead.
 *
 * One cache key per category (`['posts', category]`). Filtering one big list
 * client-side would have been fewer requests, but it makes every tab wait on
 * the slowest one and makes "no posts yet in Q&A" indistinguishable from
 * "still loading".
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { applyLikeResult, toggleLike, updateById } from '../lib/likes';
import * as communityApi from '../services/community-api';
import type { CreatePostInput, Post, PostCategory, UpdatePostInput } from '../types';

const postsKey = (category: PostCategory) => ['posts', category] as const;
const POSTS_ROOT_KEY = ['posts'] as const;
const postKey = (id: number) => ['post', id] as const;

/** Every cached feed page, whichever category it belongs to. */
function eachPostList(queryClient: QueryClient, apply: (posts: Post[]) => Post[]) {
  queryClient.setQueriesData<Post[]>({ queryKey: POSTS_ROOT_KEY }, (posts) =>
    posts ? apply(posts) : posts,
  );
}

/** The same post may sit in a feed page *and* in a detail cache. Patch both. */
function patchPostEverywhere(
  queryClient: QueryClient,
  postId: number,
  update: (post: Post) => Post,
) {
  eachPostList(queryClient, (posts) => updateById(posts, postId, update));
  queryClient.setQueryData<Post>(postKey(postId), (post) => (post ? update(post) : post));
}

export function usePosts(category: PostCategory) {
  const query = useQuery<Post[]>({
    queryKey: postsKey(category),
    queryFn: () => communityApi.fetchPosts(category),
  });

  return {
    posts: query.data ?? [],
    isLoading: query.isLoading,
    isRefetching: query.isRefetching,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * One post, for the detail route.
 *
 * **The gateway has no `post(id:)` query.** Navigating from the feed is the
 * common path and costs nothing — `initialData` finds the row in whichever
 * feed page is already cached. A cold open (deep link, app restarted on the
 * route) has no such page, so this falls back to fetching the feed and
 * picking the row out of it. That is a whole page to render one post, and it
 * is the reason a `post(id:)` query is worth adding on the gateway; it is
 * also why this is written as a real query rather than a cache read, so the
 * cold path works today instead of rendering an empty screen.
 */
export function usePost(postId: number) {
  const queryClient = useQueryClient();

  const query = useQuery<Post | undefined>({
    queryKey: postKey(postId),
    queryFn: async () => {
      const posts = await communityApi.fetchPosts();
      return posts.find((post) => post.id === postId);
    },
    initialData: () => findCachedPost(queryClient, postId),
    // Without this, `initialData` counts as fresh forever and a post opened
    // from the feed never picks up an edit made elsewhere.
    initialDataUpdatedAt: 0,
  });

  return {
    post: query.data,
    isLoading: query.isLoading,
    /** The post is genuinely gone — deleted, or never existed. */
    isMissing: !query.isLoading && !query.isError && query.data === undefined,
    error: query.error,
    refetch: query.refetch,
  };
}

function findCachedPost(queryClient: QueryClient, postId: number): Post | undefined {
  const lists = queryClient.getQueriesData<Post[]>({ queryKey: POSTS_ROOT_KEY });
  for (const [, posts] of lists) {
    const found = posts?.find((post) => post.id === postId);
    if (found) return found;
  }
  return undefined;
}

export function useCreatePost() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreatePostInput) => communityApi.createPost(input),
    onSuccess: (post) => {
      // Prepend rather than invalidate: the feed is newest-first, and the
      // author should see their post above the fold before the refetch lands.
      queryClient.setQueryData<Post[]>(postsKey(post.category), (posts) =>
        posts ? [post, ...posts] : [post],
      );
      void queryClient.invalidateQueries({ queryKey: postsKey(post.category) });
    },
  });

  return {
    createPost: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

export function useUpdatePost() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdatePostInput) => communityApi.updatePost(input),
    onSuccess: (_ok, input) => {
      // `updatePost` returns a bare Boolean, so there is no row to write back.
      // The edited text is patched in locally and both categories are
      // invalidated, because an edit may have moved the post between tabs.
      patchPostEverywhere(queryClient, input.id, (post) => ({
        ...post,
        content: input.content,
        category: input.category,
      }));
      void queryClient.invalidateQueries({ queryKey: POSTS_ROOT_KEY });
    },
  });

  return {
    updatePost: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

export function useDeletePost() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: number) => communityApi.deletePost(id),
    onSuccess: (_ok, id) => {
      eachPostList(queryClient, (posts) => posts.filter((post) => post.id !== id));
      queryClient.removeQueries({ queryKey: postKey(id) });
    },
  });

  return {
    deletePost: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Optimistic, and it has to be: a heart that fills a round trip later reads
 * as a button that did not work, and gets tapped again.
 *
 * `onMutate` cancels in-flight feed fetches first — a refetch that resolves
 * after the optimistic write would otherwise overwrite it with the pre-tap
 * state and the heart would visibly flip back.
 */
export function useToggleLike() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (postId: number) => communityApi.toggleLike(postId),

    onMutate: async (postId) => {
      await queryClient.cancelQueries({ queryKey: POSTS_ROOT_KEY });
      await queryClient.cancelQueries({ queryKey: postKey(postId) });

      const previousLists = queryClient.getQueriesData<Post[]>({ queryKey: POSTS_ROOT_KEY });
      const previousPost = queryClient.getQueryData<Post>(postKey(postId));

      patchPostEverywhere(queryClient, postId, toggleLike);

      return { previousLists, previousPost };
    },

    onError: (_error, postId, context) => {
      context?.previousLists.forEach(([key, posts]) => queryClient.setQueryData(key, posts));
      if (context?.previousPost) {
        queryClient.setQueryData(postKey(postId), context.previousPost);
      }
    },

    // The server replies with the new liked state. `applyLikeResult` is a
    // no-op when the optimistic guess was right, which is nearly always —
    // it exists for the case where it was not (a double tap, another device).
    onSuccess: (isLiked, postId) => {
      patchPostEverywhere(queryClient, postId, (post) => applyLikeResult(post, isLiked));
    },
  });

  return { toggleLike: mutation.mutate, error: mutation.error };
}
