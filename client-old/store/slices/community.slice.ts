import {
  GQL_CREATE_COMMENT,
  GQL_CREATE_POST,
  GQL_DELETE_COMMENT,
  GQL_DELETE_POST,
  GQL_POST_COMMENTS,
  GQL_POSTS,
  GQL_TOGGLE_COMMENT_LIKE,
  GQL_TOGGLE_LIKE,
  GQL_UPDATE_COMMENT,
  GQL_UPDATE_POST,
  getGraphqlEndpoint,
  graphqlRequest,
} from "@/constants/api";
import {
  deleteLocalPost,
  deletePendingPostAction,
  insertLocalPost,
  listLocalPosts,
  listPendingPostActions,
  queuePendingPostAction,
  updateLocalPost,
} from "@/data/local-db";
import { CommunityPost, PostComment } from "@/types";
import type {
  CreateCommentMutation,
  CreatePostMutation,
  DeleteCommentMutation,
  PostCommentsQuery,
  PostsQuery,
  ToggleCommentLikeMutation,
  ToggleLikeMutation,
  UpdateCommentMutation,
} from "@/types/graphql";
import type { StateCreator } from "zustand";
import {
  createClientId,
  isLocalPostId,
  parseLocalPostId,
  toLocalPostId,
} from "../shared/client-id";
import { communityDebug, communityWarn, logWarn } from "../shared/log";
import {
  commentFromGql,
  postFromGql,
  postFromLocal,
  sortCommentsAsc,
  sortPostsDesc,
} from "../shared/mappers";
import type { AppState } from "../use-app-store";

// Promise-based mutex: concurrent callers await the same in-flight sync
// instead of racing past a boolean flag and double-syncing.
let syncPostsPromise: Promise<void> | null = null;

export interface CommunitySlice {
  posts: CommunityPost[];
  commentsByPostId: Record<string, PostComment[]>;

  fetchPosts: () => Promise<void>;
  hydratePendingPosts: () => Promise<void>;
  syncPendingPosts: () => Promise<void>;
  toggleLike: (postId: string) => Promise<void>;
  createPost: (input: {
    content: string;
    category: CommunityPost["category"];
  }) => Promise<boolean>;
  updatePost: (input: {
    postId: string;
    content: string;
    category: CommunityPost["category"];
  }) => Promise<boolean>;
  deletePost: (postId: string) => Promise<boolean>;
  fetchPostComments: (postId: string) => Promise<void>;
  createComment: (input: {
    postId: string;
    content: string;
    parentId?: string;
  }) => Promise<boolean>;
  updateComment: (input: {
    commentId: string;
    content: string;
  }) => Promise<boolean>;
  deleteComment: (postId: string, commentId: string) => Promise<boolean>;
  toggleCommentLike: (postId: string, commentId: string) => Promise<void>;
}

export const createCommunitySlice: StateCreator<
  AppState,
  [],
  [],
  CommunitySlice
> = (set, get) => ({
  posts: [],
  commentsByPostId: {},

  fetchPosts: async () => {
    try {
      const token = get().authToken;
      communityDebug("fetchPosts start", {
        endpoint: getGraphqlEndpoint(),
        hasToken: Boolean(token),
      });
      const data = await graphqlRequest<PostsQuery>(
        GQL_POSTS,
        { limit: 100, offset: 0 },
        token,
      );
      const remotePosts = data.posts.map(postFromGql);
      const localPosts = get().posts.filter((p) => isLocalPostId(p.id));
      communityDebug("fetchPosts success", {
        remoteCount: remotePosts.length,
        localVisibleCount: localPosts.length,
      });
      set({ posts: sortPostsDesc([...localPosts, ...remotePosts]) });
    } catch (error) {
      communityWarn("fetchPosts failed", error);
    }
  },

  hydratePendingPosts: async () => {
    const currentUser = get().user;
    if (!currentUser) {
      communityDebug("hydratePendingPosts skipped", { reason: "missing-user" });
      return;
    }
    const localRows = await listLocalPosts(currentUser.id);
    communityDebug("hydratePendingPosts loaded", {
      localCount: localRows.length,
      userId: currentUser.id,
    });
    const localPosts = localRows.map(postFromLocal);
    set((state) => {
      const remotePosts = state.posts.filter((p) => !isLocalPostId(p.id));
      return { posts: sortPostsDesc([...localPosts, ...remotePosts]) };
    });
  },

  syncPendingPosts: async () => {
    const currentUser = get().user;
    const token = get().authToken;
    const isOnline = get().isOnline;
    if (!currentUser || !token || !isOnline) {
      communityDebug("syncPendingPosts skipped", {
        hasUser: Boolean(currentUser),
        hasToken: Boolean(token),
        isOnline,
      });
      return;
    }
    if (syncPostsPromise) {
      communityDebug("syncPendingPosts skipped", { reason: "in-flight" });
      return syncPostsPromise;
    }

    syncPostsPromise = (async () => {
      try {
        const localRows = await listLocalPosts(currentUser.id);
        communityDebug("syncPendingPosts start", {
          endpoint: getGraphqlEndpoint(),
          localCount: localRows.length,
          userId: currentUser.id,
        });
        // Clear any prior sync-failure flags before re-attempting — a fresh
        // pass should present as "saving", not "failed", until it actually
        // fails again.
        if (localRows.length > 0) {
          set((state) => ({
            posts: state.posts.map((p) =>
              p.syncStatus === "local" && p.syncError
                ? { ...p, syncError: false }
                : p,
            ),
          }));
        }
        for (const row of localRows) {
          try {
            const docId = row.clientId || `local-post-${row.userId}-${row.id}`;
            communityDebug("syncPendingPosts uploading local post", {
              localId: row.id,
              clientId: docId,
              category: row.category,
            });
            await graphqlRequest(
              GQL_CREATE_POST,
              {
                input: {
                  content: row.content,
                  category: row.category,
                  clientId: docId,
                },
              },
              token,
            );
            await deleteLocalPost(row.id);
            set((state) => ({
              posts: state.posts.filter(
                (p) => p.id !== toLocalPostId(row.id),
              ),
            }));
            communityDebug("syncPendingPosts uploaded local post", {
              localId: row.id,
              clientId: docId,
            });
          } catch (error) {
            communityWarn("syncPendingPosts failed for local post", error, {
              localId: row.id,
              clientId: row.clientId,
            });
            // Flag this post so the card surfaces a tappable retry instead of
            // sitting on a silent "saved on device" badge forever.
            set((state) => ({
              posts: state.posts.map((p) =>
                p.id === toLocalPostId(row.id)
                  ? { ...p, syncError: true }
                  : p,
              ),
            }));
          }
        }

        const pendingActions = await listPendingPostActions(currentUser.id);
        communityDebug("syncPendingPosts actions", {
          actionCount: pendingActions.length,
        });
        for (const action of pendingActions) {
          try {
            if (action.action === "delete") {
              await graphqlRequest(
                GQL_DELETE_POST,
                { id: Number(action.postId) },
                token,
              );
            } else {
              await graphqlRequest(
                GQL_UPDATE_POST,
                {
                  input: {
                    id: Number(action.postId),
                    ...(typeof action.content === "string"
                      ? { content: action.content }
                      : null),
                    ...(typeof action.category === "string"
                      ? { category: action.category }
                      : null),
                  },
                },
                token,
              );
            }
            await deletePendingPostAction(action.id);
            communityDebug("syncPendingPosts action synced", {
              actionId: action.id,
              action: action.action,
              postId: action.postId,
            });
          } catch (error) {
            communityWarn("syncPendingPosts action failed", error, {
              actionId: action.id,
              action: action.action,
              postId: action.postId,
            });
          }
        }

        void get().fetchPosts();
      } finally {
        syncPostsPromise = null;
      }
    })();

    return syncPostsPromise;
  },

  toggleLike: async (postId) => {
    const token = get().authToken;
    const isOnline = get().isOnline;
    if (!token || !isOnline || isLocalPostId(postId)) {
      communityDebug("toggleLike skipped", {
        postId,
        hasToken: Boolean(token),
        isOnline,
        isLocalPost: isLocalPostId(postId),
      });
      return;
    }

    const previousPosts = get().posts;
    set((state) => ({
      posts: state.posts.map((p) =>
        p.id === postId
          ? {
              ...p,
              isLiked: !p.isLiked,
              likes: p.isLiked ? Math.max(0, p.likes - 1) : p.likes + 1,
            }
          : p,
      ),
    }));

    try {
      communityDebug("toggleLike request", { postId });
      const data = await graphqlRequest<ToggleLikeMutation>(
        GQL_TOGGLE_LIKE,
        { postId: Number(postId) },
        token,
      );
      communityDebug("toggleLike success", {
        postId,
        isLiked: data.toggleLike,
      });
      set((state) => ({
        posts: state.posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                isLiked: data.toggleLike,
              }
            : p,
        ),
      }));
    } catch (error) {
      communityWarn("toggleLike failed; rolling back", error, { postId });
      set({ posts: previousPosts });
    }
  },

  createPost: async ({ content, category }) => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser) {
      communityDebug("createPost skipped", { reason: "missing-user" });
      return false;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      communityDebug("createPost skipped", { reason: "empty-content" });
      return false;
    }

    const createdAt = new Date();
    const clientId = createClientId("post", currentUser.id);
    const isOnline = get().isOnline;

    communityDebug("createPost start", {
      endpoint: getGraphqlEndpoint(),
      hasToken: Boolean(token),
      isOnline,
      category,
      clientId,
    });

    if (isOnline && token) {
      try {
        const data = await graphqlRequest<CreatePostMutation>(
          GQL_CREATE_POST,
          { input: { content: trimmed, category, clientId } },
          token,
        );
        const remotePost = postFromGql(data.createPost);
        communityDebug("createPost remote success", {
          postId: remotePost.id,
          clientId,
        });
        set((state) => ({
          posts: sortPostsDesc([
            remotePost,
            ...state.posts.filter((post) => post.clientId !== clientId),
          ]),
        }));
        void get().fetchPosts();
        return true;
      } catch (error) {
        communityWarn(
          "createPost remote failed; saving local fallback",
          error,
          { clientId },
        );
      }
    } else {
      communityDebug("createPost using local fallback", {
        reason: !isOnline ? "offline" : "missing-token",
        hasToken: Boolean(token),
        isOnline,
        clientId,
      });
    }

    const localId = await insertLocalPost({
      userId: currentUser.id,
      clientId,
      userName:
        `${currentUser.firstname} ${currentUser.lastname}`.trim() || "ผู้ใช้",
      userAvatar: currentUser.avatar || null,
      content: trimmed,
      category,
      createdAt: createdAt.toISOString(),
    });

    if (localId) {
      const localPost = postFromLocal({
        id: localId,
        userId: currentUser.id,
        clientId,
        userName:
          `${currentUser.firstname} ${currentUser.lastname}`.trim() || "ผู้ใช้",
        userAvatar: currentUser.avatar || null,
        content: trimmed,
        category,
        createdAt: createdAt.toISOString(),
      });
      set((state) => ({
        posts: sortPostsDesc([localPost, ...state.posts]),
      }));
    }

    communityDebug("createPost local fallback saved", {
      localId,
      clientId,
    });
    return Boolean(localId);
  },

  updatePost: async ({ postId, content, category }) => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser) return false;

    const trimmed = content.trim();
    if (!trimmed) return false;

    const post = get().posts.find((p) => p.id === postId);
    if (!post || post.userId !== currentUser.id) return false;

    if (isLocalPostId(postId)) {
      const localId = parseLocalPostId(postId);
      if (!Number.isNaN(localId)) {
        await updateLocalPost(localId, { content: trimmed, category });
      }
      set((state) => ({
        posts: state.posts.map((p) =>
          p.id === postId
            ? { ...p, content: trimmed, category, syncStatus: "local" as const }
            : p,
        ),
      }));
      return true;
    }

    if (!get().isOnline || !token) {
      await queuePendingPostAction({
        userId: currentUser.id,
        postId,
        action: "update",
        content: trimmed,
        category,
        updatedAt: new Date().toISOString(),
      });
      set((state) => ({
        posts: state.posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                content: trimmed,
                category,
                syncStatus: "pending-update" as const,
              }
            : p,
        ),
      }));
      return true;
    }

    try {
      await graphqlRequest(
        GQL_UPDATE_POST,
        { input: { id: Number(postId), content: trimmed, category } },
        token,
      );
      void get().fetchPosts();
      return true;
    } catch (error) {
      logWarn("Posts", "updatePost remote failed", error, { postId });
      return false;
    }
  },

  deletePost: async (postId) => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser) return false;

    const post = get().posts.find((p) => p.id === postId);
    if (!post || post.userId !== currentUser.id) return false;

    if (isLocalPostId(postId)) {
      const localId = parseLocalPostId(postId);
      if (!Number.isNaN(localId)) await deleteLocalPost(localId);
      set((state) => ({
        posts: state.posts.filter((p) => p.id !== postId),
      }));
      return true;
    }

    if (!get().isOnline || !token) {
      await queuePendingPostAction({
        userId: currentUser.id,
        postId,
        action: "delete",
        content: null,
        category: null,
        updatedAt: new Date().toISOString(),
      });
      set((state) => ({
        posts: state.posts.filter((p) => p.id !== postId),
      }));
      return true;
    }

    try {
      await graphqlRequest(GQL_DELETE_POST, { id: Number(postId) }, token);
      set((state) => ({
        posts: state.posts.filter((p) => p.id !== postId),
      }));
      return true;
    } catch (error) {
      logWarn("Posts", "deletePost remote failed", error, { postId });
      return false;
    }
  },

  fetchPostComments: async (postId) => {
    if (isLocalPostId(postId)) {
      communityDebug("fetchPostComments skipped", {
        postId,
        reason: "local-post",
      });
      set((state) => ({
        commentsByPostId: { ...state.commentsByPostId, [postId]: [] },
      }));
      return;
    }

    try {
      const token = get().authToken;
      communityDebug("fetchPostComments start", {
        postId,
        hasToken: Boolean(token),
      });
      const data = await graphqlRequest<PostCommentsQuery>(
        GQL_POST_COMMENTS,
        { postId: Number(postId), parentId: null },
        token,
      );
      communityDebug("fetchPostComments success", {
        postId,
        count: data.postComments.length,
      });
      set((state) => ({
        commentsByPostId: {
          ...state.commentsByPostId,
          [postId]: sortCommentsAsc(data.postComments.map(commentFromGql)),
        },
      }));
    } catch (error) {
      communityWarn("fetchPostComments failed", error, { postId });
    }
  },

  createComment: async ({ postId, content, parentId }) => {
    const token = get().authToken;
    const isOnline = get().isOnline;
    if (!token || !isOnline || isLocalPostId(postId)) {
      communityDebug("createComment skipped", {
        postId,
        hasToken: Boolean(token),
        isOnline,
        isLocalPost: isLocalPostId(postId),
      });
      return false;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      communityDebug("createComment skipped", {
        postId,
        reason: "empty-content",
      });
      return false;
    }

    try {
      communityDebug("createComment request", { postId, parentId });
      const data = await graphqlRequest<CreateCommentMutation>(
        GQL_CREATE_COMMENT,
        {
          input: {
            postId: Number(postId),
            content: trimmed,
            parentId: parentId ? Number(parentId) : null,
          },
        },
        token,
      );
      const comment = commentFromGql(data.createComment);
      communityDebug("createComment success", {
        postId,
        commentId: comment.id,
      });

      set((state) => ({
        commentsByPostId: {
          ...state.commentsByPostId,
          [postId]: sortCommentsAsc([
            ...(state.commentsByPostId[postId] ?? []),
            comment,
          ]),
        },
        posts: state.posts.map((post) =>
          post.id === postId
            ? { ...post, comments: post.comments + 1 }
            : post,
        ),
      }));
      return true;
    } catch (error) {
      communityWarn("createComment failed", error, { postId, parentId });
      return false;
    }
  },

  updateComment: async ({ commentId, content }) => {
    const token = get().authToken;
    if (!token || !get().isOnline) {
      communityDebug("updateComment skipped", {
        commentId,
        hasToken: Boolean(token),
        isOnline: get().isOnline,
      });
      return false;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      communityDebug("updateComment skipped", {
        commentId,
        reason: "empty-content",
      });
      return false;
    }

    try {
      communityDebug("updateComment request", { commentId });
      const data = await graphqlRequest<UpdateCommentMutation>(
        GQL_UPDATE_COMMENT,
        { input: { id: Number(commentId), content: trimmed } },
        token,
      );
      const updated = commentFromGql(data.updateComment);
      communityDebug("updateComment success", {
        commentId,
        postId: updated.postId,
      });
      set((state) => {
        const postComments = state.commentsByPostId[updated.postId] ?? [];
        return {
          commentsByPostId: {
            ...state.commentsByPostId,
            [updated.postId]: postComments.map((comment) =>
              comment.id === updated.id ? updated : comment,
            ),
          },
        };
      });
      return true;
    } catch (error) {
      communityWarn("updateComment failed", error, { commentId });
      return false;
    }
  },

  deleteComment: async (postId, commentId) => {
    const token = get().authToken;
    if (!token || !get().isOnline) {
      communityDebug("deleteComment skipped", {
        postId,
        commentId,
        hasToken: Boolean(token),
        isOnline: get().isOnline,
      });
      return false;
    }

    try {
      communityDebug("deleteComment request", { postId, commentId });
      const data = await graphqlRequest<DeleteCommentMutation>(
        GQL_DELETE_COMMENT,
        { id: Number(commentId) },
        token,
      );
      if (!data.deleteComment) return false;
      communityDebug("deleteComment success", { postId, commentId });

      set((state) => ({
        commentsByPostId: {
          ...state.commentsByPostId,
          [postId]: (state.commentsByPostId[postId] ?? []).filter(
            (comment) => comment.id !== commentId,
          ),
        },
        posts: state.posts.map((post) =>
          post.id === postId
            ? { ...post, comments: Math.max(0, post.comments - 1) }
            : post,
        ),
      }));
      return true;
    } catch (error) {
      communityWarn("deleteComment failed", error, { postId, commentId });
      return false;
    }
  },

  toggleCommentLike: async (postId, commentId) => {
    const token = get().authToken;
    const isOnline = get().isOnline;
    if (!token || !isOnline) {
      communityDebug("toggleCommentLike skipped", {
        postId,
        commentId,
        hasToken: Boolean(token),
        isOnline,
      });
      return;
    }

    set((state) => ({
      commentsByPostId: {
        ...state.commentsByPostId,
        [postId]: (state.commentsByPostId[postId] ?? []).map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                isLiked: !comment.isLiked,
                likes: comment.isLiked
                  ? Math.max(0, comment.likes - 1)
                  : comment.likes + 1,
              }
            : comment,
        ),
      },
    }));

    try {
      communityDebug("toggleCommentLike request", { postId, commentId });
      const data = await graphqlRequest<ToggleCommentLikeMutation>(
        GQL_TOGGLE_COMMENT_LIKE,
        { commentId: Number(commentId) },
        token,
      );
      communityDebug("toggleCommentLike success", {
        postId,
        commentId,
        isLiked: data.toggleCommentLike,
      });
    } catch (error) {
      communityWarn("toggleCommentLike failed; refreshing comments", error, {
        postId,
        commentId,
      });
      void get().fetchPostComments(postId);
    }
  },
});
