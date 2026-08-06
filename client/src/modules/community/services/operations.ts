/**
 * Community GraphQL operations.
 *
 * `POST_FIELDS` is shared by the feed query and by every post mutation that
 * returns a row. The mutations request the full shape on purpose: the like
 * and edit paths write the returned post straight into the cache, and a
 * partial selection there would blank whichever field it omitted.
 *
 * **Missing from the gateway: a single-post query.** There is no `post(id:)`,
 * so `hooks/use-posts.ts::usePost` reconstructs one from the feed. See the
 * note there.
 */

const POST_FIELDS = `
  id
  userId
  userName
  userAvatar
  content
  category
  likes
  comments
  isLiked
  createdAt
  updatedAt
`;

const COMMENT_FIELDS = `
  id
  postId
  userId
  userName
  userAvatar
  content
  likes
  replies
  isLiked
  parentId
  createdAt
  updatedAt
`;

export const GQL_POSTS = `
  query Posts($category: String, $limit: Int!, $offset: Int!) {
    posts(category: $category, limit: $limit, offset: $offset) { ${POST_FIELDS} }
  }
`;

export const GQL_CREATE_POST = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) { ${POST_FIELDS} }
  }
`;

// Returns `Boolean!`, not the post — the caller has to refetch or patch the
// cache itself.
export const GQL_UPDATE_POST = `
  mutation UpdatePost($input: UpdatePostInput!) {
    updatePost(input: $input)
  }
`;

export const GQL_DELETE_POST = `
  mutation DeletePost($id: Int!) {
    deletePost(id: $id)
  }
`;

/** Returns the *new* liked state, so the caller does not have to guess. */
export const GQL_TOGGLE_LIKE = `
  mutation ToggleLike($postId: Int!) {
    toggleLike(postId: $postId)
  }
`;

export const GQL_POST_COMMENTS = `
  query PostComments($postId: Int!) {
    postComments(postId: $postId) { ${COMMENT_FIELDS} }
  }
`;

export const GQL_CREATE_COMMENT = `
  mutation CreateComment($input: CreateCommentInput!) {
    createComment(input: $input) { ${COMMENT_FIELDS} }
  }
`;

export const GQL_UPDATE_COMMENT = `
  mutation UpdateComment($input: UpdateCommentInput!) {
    updateComment(input: $input) { ${COMMENT_FIELDS} }
  }
`;

export const GQL_DELETE_COMMENT = `
  mutation DeleteComment($id: Int!) {
    deleteComment(id: $id)
  }
`;

export const GQL_TOGGLE_COMMENT_LIKE = `
  mutation ToggleCommentLike($commentId: Int!) {
    toggleCommentLike(commentId: $commentId)
  }
`;
