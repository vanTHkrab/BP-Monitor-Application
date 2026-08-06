/**
 * Public surface of the community module. Screens import from here, never
 * from a file inside — same rule as the other modules.
 *
 * `services/*` stays unexported: a screen calling the GraphQL layer directly
 * would skip the cache writes the hooks own, and a like count that disagrees
 * between the feed and the post it opened is exactly the bug that makes
 * people tap the heart twice.
 */
export {
  useCreatePost,
  useDeletePost,
  usePost,
  usePosts,
  useToggleLike,
  useUpdatePost,
} from './hooks/use-posts';
export {
  useCreateComment,
  useDeleteComment,
  usePostComments,
  useToggleCommentLike,
  useUpdateComment,
} from './hooks/use-comments';

export {
  DEFAULT_CATEGORY,
  POST_CATEGORIES,
  categoryHint,
  categoryLabel,
  parseCategory,
} from './lib/categories';
export { applyLikeResult, toggleLike, updateById, type Likeable } from './lib/likes';
export { formatRelativeTimeTH } from './lib/relative-time';

export { CategoryTabs } from './components/category-tabs';
export { CommentComposer, COMMENT_MAX_LENGTH } from './components/comment-composer';
export { CommentRow } from './components/comment-row';
export { PostCard } from './components/post-card';
export { PostComposer, POST_MAX_LENGTH } from './components/post-composer';

export type {
  Comment,
  CreatePostInput,
  Post,
  PostCategory,
  UpdatePostInput,
} from './types';
