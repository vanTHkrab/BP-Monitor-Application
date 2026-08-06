/**
 * Community domain types.
 *
 * Shapes mirror `server/app/api-gateway/src/schema.gql` (`PostType`,
 * `CommentType`). The generated schema is the contract — when it moves, this
 * file moves with it in the same change.
 *
 * Ids are numbers, not strings: the gateway types both `Post.id` and
 * `Comment.id` as `Int!`. client-old carried them as strings because its
 * offline queue minted `local-post-…` ids for rows that had no server id yet.
 * This tree has no post queue (see `services/query-client.ts` — community is
 * network-only), so nothing here ever holds an id the server did not issue.
 */

/** The three feed tabs. Values are what the gateway stores in `category`. */
export type PostCategory = 'general' | 'experience' | 'qa';

export type Post = {
  id: number;
  userId: string;
  userName: string;
  userAvatar?: string;
  content: string;
  category: PostCategory;
  likes: number;
  /** Comment count, from the server. Not the length of any loaded list. */
  comments: number;
  isLiked: boolean;
  createdAt: Date;
  updatedAt?: Date;
};

export type Comment = {
  id: number;
  postId: number;
  userId: string;
  userName: string;
  userAvatar?: string;
  content: string;
  likes: number;
  isLiked: boolean;
  /**
   * Present in the schema and unused by this UI — comments render flat, as
   * they did in client-old. Kept on the type so a future threaded view is a
   * UI change rather than a re-plumbing of the whole module.
   */
  parentId?: number;
  replies: number;
  createdAt: Date;
  updatedAt?: Date;
};

export type CreatePostInput = {
  content: string;
  category: PostCategory;
};

export type UpdatePostInput = {
  id: number;
  content: string;
  category: PostCategory;
};
