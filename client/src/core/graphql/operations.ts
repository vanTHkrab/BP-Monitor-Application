// GraphQL operation strings (queries + mutations) for the NestJS gateway.
//
// Grouped by domain. Each entry is a raw string passed to the transport
// in `./client.ts`; we keep them as strings (not parsed AST) because the
// app does not run a normalized cache layer — see /core/graphql/README
// for the architectural decision.

// ── Auth ───────────────────────────────────────────────────────────

export const GQL_REGISTER = `
  mutation Register($input: RegisterInput!) {
    register(input: $input) {
      token
      user {
        id firstname lastname phone email avatar role createdAt
        dob gender weight height congenitalDisease
      }
    }
  }
`;

export const GQL_LOGIN = `
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      token
      user {
        id firstname lastname phone email avatar role createdAt
        dob gender weight height congenitalDisease
      }
    }
  }
`;

export const GQL_LOGIN_SESSIONS = `
  query LoginSessions {
    loginSessions {
      id
      deviceLabel
      userAgent
      isActive
      revokedAt
      lastActiveAt
      createdAt
    }
  }
`;

export const GQL_ME = `
  query Me {
    me {
      id firstname lastname phone email avatar role createdAt
      dob gender weight height congenitalDisease
    }
  }
`;

export const GQL_UPDATE_PROFILE = `
  mutation UpdateProfile($input: UpdateProfileInput!) {
    updateProfile(input: $input) {
      id firstname lastname phone email avatar role createdAt
      dob gender weight height congenitalDisease
    }
  }
`;

export const GQL_CHANGE_PASSWORD = `
  mutation ChangePassword($input: ChangePasswordInput!) {
    changePassword(input: $input)
  }
`;

export const GQL_VERIFY_PASSWORD = `
  mutation VerifyPassword($password: String!) {
    verifyPassword(password: $password)
  }
`;

export const GQL_LOGOUT = `
  mutation Logout {
    logout
  }
`;

export const GQL_LOGOUT_ALL_DEVICES = `
  mutation LogoutAllDevices {
    logoutAllDevices
  }
`;

export const GQL_DELETE_MY_DATA = `
  mutation DeleteMyData {
    deleteMyData
  }
`;

// ── Image upload (direct-to-S3 via presigned PUT) ───────────────────

export const GQL_REQUEST_IMAGE_UPLOAD = `
  mutation RequestImageUpload($input: RequestImageUploadInput!) {
    requestImageUpload(input: $input) {
      uploadUrl
      key
      headers { name value }
      expiresAt
    }
  }
`;

export const GQL_CONFIRM_IMAGE_UPLOAD = `
  mutation ConfirmImageUpload($input: ConfirmImageUploadInput!) {
    confirmImageUpload(input: $input) {
      key
      url
      imageId
    }
  }
`;

// ── BP readings ────────────────────────────────────────────────────

export const GQL_READINGS = `
  query Readings($limit: Int, $offset: Int) {
    readings(limit: $limit, offset: $offset) {
      id userId clientId systolic diastolic pulse status measuredAt s3Key notes createdAt
    }
  }
`;

export const GQL_CREATE_READING = `
  mutation CreateReading($input: CreateReadingInput!) {
    createReading(input: $input) {
      id userId clientId systolic diastolic pulse status measuredAt s3Key notes createdAt
    }
  }
`;

export const GQL_DELETE_READING = `
  mutation DeleteReading($id: Int!) {
    deleteReading(id: $id)
  }
`;

// ── Community posts ────────────────────────────────────────────────

export const GQL_POSTS = `
  query Posts($category: String, $limit: Int, $offset: Int) {
    posts(category: $category, limit: $limit, offset: $offset) {
      id userId clientId userName userAvatar content category likes comments createdAt updatedAt isLiked
    }
  }
`;

export const GQL_CREATE_POST = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      id userId clientId userName userAvatar content category likes comments createdAt updatedAt isLiked
    }
  }
`;

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

export const GQL_TOGGLE_LIKE = `
  mutation ToggleLike($postId: Int!) {
    toggleLike(postId: $postId)
  }
`;

// ── Comments ───────────────────────────────────────────────────────

export const GQL_POST_COMMENTS = `
  query PostComments($postId: Int!, $parentId: Int) {
    postComments(postId: $postId, parentId: $parentId) {
      id postId userId parentId userName userAvatar content likes replies createdAt updatedAt isLiked
    }
  }
`;

export const GQL_CREATE_COMMENT = `
  mutation CreateComment($input: CreateCommentInput!) {
    createComment(input: $input) {
      id postId userId parentId userName userAvatar content likes replies createdAt updatedAt isLiked
    }
  }
`;

export const GQL_UPDATE_COMMENT = `
  mutation UpdateComment($input: UpdateCommentInput!) {
    updateComment(input: $input) {
      id postId userId parentId userName userAvatar content likes replies createdAt updatedAt isLiked
    }
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

// ── Alerts ─────────────────────────────────────────────────────────

export const GQL_ALERTS = `
  query Alerts($limit: Int, $offset: Int, $unreadOnly: Boolean) {
    alerts(limit: $limit, offset: $offset, unreadOnly: $unreadOnly) {
      id
      userId
      bpReadingId
      alertMessage
      alertLevel
      readAt
      createdAt
      reading {
        id
        systolic
        diastolic
        pulse
        status
        measuredAt
        s3Key
      }
    }
  }
`;

export const GQL_MARK_ALERT_READ = `
  mutation MarkAlertRead($id: Int!) {
    markAlertRead(id: $id)
  }
`;

export const GQL_MARK_ALL_ALERTS_READ = `
  mutation MarkAllAlertsRead {
    markAllAlertsRead
  }
`;

// ── Caregivers ─────────────────────────────────────────────────────

export const GQL_CAREGIVER_LINKS = `
  query CaregiverLinks {
    caregiverLinks {
      caregiverId
      patientId
      relationship
      caregiverName
      caregiverPhone
      patientName
      patientPhone
    }
  }
`;

export const GQL_ADD_CAREGIVER_PATIENT = `
  mutation AddCaregiverPatient($patientPhone: String!, $relationship: String!) {
    addCaregiverPatient(patientPhone: $patientPhone, relationship: $relationship) {
      caregiverId
      patientId
      relationship
      caregiverName
      caregiverPhone
      patientName
      patientPhone
    }
  }
`;

export const GQL_REMOVE_CAREGIVER_PATIENT = `
  mutation RemoveCaregiverPatient($caregiverId: String!, $patientId: String!) {
    removeCaregiverPatient(caregiverId: $caregiverId, patientId: $patientId)
  }
`;

// __DEV__-only: cross-tier media diff for the signed-in user. The server
// resolver returns 403 when NODE_ENV === 'production', so the page that
// calls this should be __DEV__-gated too.
export const GQL_DEBUG_MY_STORAGE = `
  query DebugMyStorage {
    debugMyStorage {
      generatedAt
      userId
      items {
        source
        refId
        rawKey
        s3Exists
        s3ContentLength
        note
      }
    }
  }
`;
