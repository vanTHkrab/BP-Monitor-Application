// constants/api.ts — GraphQL client helper for communicating with NestJS API Gateway
import { GraphQLClientError } from "@/lib/graphql-error";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const DEFAULT_API_PORT = "3000";
const REQUEST_TIMEOUT_MS = 30000;

const isLoopbackHost = (host: string) =>
  host === "127.0.0.1" ||
  host === "localhost" ||
  host === "::1" ||
  host === "0.0.0.0";

interface ConstantsHostShape {
  expoGoConfig?: { debuggerHost?: string; hostUri?: string };
  manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  manifest?: { debuggerHost?: string };
  platform?: { hostUri?: string };
}

const getExpoHostUri = (): string | null => {
  const c = Constants as unknown as ConstantsHostShape;
  const possibleHostUri =
    Constants.expoConfig?.hostUri ||
    c.expoGoConfig?.debuggerHost ||
    c.expoGoConfig?.hostUri ||
    c.manifest2?.extra?.expoClient?.hostUri ||
    c.manifest?.debuggerHost ||
    c.platform?.hostUri ||
    null;

  return typeof possibleHostUri === "string" && possibleHostUri.length > 0
    ? possibleHostUri
    : null;
};

const resolveApiUrl = (): string => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  const hostUri = getExpoHostUri();
  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host && !isLoopbackHost(host)) {
      return `http://${host}:${DEFAULT_API_PORT}/graphql`;
    }
  }

  // No env var and no usable Expo host — fail loudly so misconfiguration is
  // obvious rather than silently hitting some other developer's LAN box.
  throw new Error(
    "[GraphQL] EXPO_PUBLIC_API_URL is not set and no usable Expo host URI was " +
      "found. Add EXPO_PUBLIC_API_URL=http://<host>:3000/graphql to client/.env " +
      "(or to app.json's `expo.extra` for a build).",
  );
};

const API_URL = resolveApiUrl();
if (__DEV__) console.log(`[GraphQL] endpoint=${API_URL}`);

export const getApiBaseUrl = () => API_URL.replace(/\/graphql\/?$/, "");
export const getGraphqlEndpoint = () => API_URL;

// SecureStore keys must match /^[A-Za-z0-9._-]+$/, so the original
// "bp:auth-token" key is kept only for legacy AsyncStorage migration.
const LEGACY_TOKEN_KEY = "bp:auth-token";
const TOKEN_KEY = "bp_auth_token";

// SecureStore is iOS/Android only. On web we fall back to AsyncStorage so
// the dev `expo start --web` flow keeps working.
const useSecureStore = Platform.OS === "ios" || Platform.OS === "android";

const removeLegacyToken = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // best-effort cleanup
  }
};

// ── Token Management ──

export const setAuthToken = async (token: string): Promise<void> => {
  if (useSecureStore) {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    await removeLegacyToken();
    return;
  }
  await AsyncStorage.setItem(TOKEN_KEY, token);
};

export const getAuthToken = async (): Promise<string | null> => {
  if (useSecureStore) {
    const secure = await SecureStore.getItemAsync(TOKEN_KEY);
    if (secure) return secure;

    // One-time migration: pull token written by the old AsyncStorage path
    // into SecureStore, then clear the legacy entry.
    const legacy = await AsyncStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacy) {
      try {
        await SecureStore.setItemAsync(TOKEN_KEY, legacy);
      } finally {
        await removeLegacyToken();
      }
      return legacy;
    }
    return null;
  }
  return AsyncStorage.getItem(TOKEN_KEY);
};

export const clearAuthToken = async (): Promise<void> => {
  if (useSecureStore) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await removeLegacyToken();
    return;
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
};

// ── Session-expired handler ──

// Registered once at app bootstrap (by the auth slice) so any GraphQL
// transport in this codebase can notify the store when the server rejects
// our token. We keep it module-level instead of importing the store here
// because `constants/api.ts` is imported by the slices themselves — a
// direct import would form an import cycle.

type UnauthenticatedHandler = () => void | Promise<void>;
let unauthenticatedHandler: UnauthenticatedHandler | null = null;

export const setUnauthenticatedHandler = (
  handler: UnauthenticatedHandler | null,
): void => {
  unauthenticatedHandler = handler;
};

/**
 * Notify the registered handler that the server rejected our token. Safe to
 * call from any GraphQL transport. Fire-and-forget — the calling code should
 * still throw whatever error it was going to throw; this just kicks off the
 * client-side cleanup in parallel.
 */
export const fireUnauthenticated = (): void => {
  if (!unauthenticatedHandler) return;
  try {
    const result = unauthenticatedHandler();
    if (result && typeof (result as Promise<void>).then === "function") {
      (result as Promise<void>).catch(() => {});
    }
  } catch {
    // Handler errors must never bubble — we're already in an error path.
  }
};

// ── GraphQL Request ──

interface GqlError {
  message: string;
  extensions?: Record<string, unknown> & { code?: string };
}

interface GqlResponse<T = unknown> {
  data?: T;
  errors?: GqlError[];
}

// Surface GraphQL extension codes (Apollo / Mercurius style: UNAUTHENTICATED,
// FORBIDDEN, BAD_USER_INPUT, …) inside the thrown message so downstream
// formatters in lib/error-message.ts can map them to localized copy.
const formatGqlErrors = (errors: GqlError[]): string =>
  errors
    .map((e) => {
      const code =
        typeof e.extensions?.code === "string" ? e.extensions.code : null;
      return code ? `[${code}] ${e.message}` : e.message;
    })
    .join("; ");

const getOperationName = (query: string): string => {
  const match = query.match(/\b(query|mutation)\s+([A-Za-z0-9_]+)/);
  return match?.[2] ?? "AnonymousOperation";
};

export async function graphqlRequest<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string | null,
): Promise<T> {
  const operationName = getOperationName(query);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    if (__DEV__) {
      console.log(`[GraphQL] ${operationName} request`, {
        endpoint: API_URL,
        hasToken: Boolean(token),
        variableKeys: variables ? Object.keys(variables) : [],
      });
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const rawText = await res.text();
    let json: GqlResponse<T>;

    try {
      json = JSON.parse(rawText) as GqlResponse<T>;
    } catch {
      if (__DEV__) {
        console.warn(`[GraphQL] ${operationName} invalid JSON response`, {
          status: res.status,
          endpoint: API_URL,
          preview: rawText.slice(0, 180),
        });
      }
      throw new Error(
        `Invalid JSON response from server while calling ${operationName} (HTTP ${res.status})`,
      );
    }

    // Prefer the standard HTTP `Retry-After` header but fall back to a custom
    // `extensions.retryAfterSec` (lifted from NestJS HttpException body by the
    // gateway's errorFormatter) so the throttle countdown still works even
    // when the server hasn't set the header.
    const readRetryAfter = (firstError: GqlError | undefined): number | null => {
      const headerRaw = res.headers.get("Retry-After");
      const headerParsed = headerRaw ? Number(headerRaw) : NaN;
      if (Number.isFinite(headerParsed)) return headerParsed;
      const ext = firstError?.extensions?.retryAfterSec;
      return typeof ext === "number" && Number.isFinite(ext) ? ext : null;
    };

    // Only fire the auto-logout handler when a token was actually sent.
    // A 401 / UNAUTHENTICATED on an anonymous request (login, register) just
    // means "wrong credentials" — auto-logging-out the not-logged-in user
    // would be nonsense and would race with the login mutation's own error
    // handling.
    const handleAuthFailure = (code: string | null): void => {
      if (!token) return;
      if (res.status === 401 || code === "UNAUTHENTICATED") {
        fireUnauthenticated();
      }
    };

    if (!res.ok) {
      const firstError = json.errors?.[0];
      const code =
        typeof firstError?.extensions?.code === "string"
          ? firstError.extensions.code
          : null;
      const msg =
        (json.errors && json.errors.length > 0
          ? formatGqlErrors(json.errors)
          : null) || `HTTP ${res.status}`;
      const retryAfterSec = readRetryAfter(firstError);
      if (__DEV__) {
        console.warn(`[GraphQL] ${operationName} HTTP error`, {
          status: res.status,
          code,
          retryAfterSec,
          message: msg,
        });
      }
      handleAuthFailure(code);
      throw new GraphQLClientError(`${operationName} failed: ${msg}`, {
        code,
        httpStatus: res.status,
        retryAfterSec,
      });
    }

    if (json.errors && json.errors.length > 0) {
      const firstError = json.errors[0];
      const code =
        typeof firstError?.extensions?.code === "string"
          ? firstError.extensions.code
          : null;
      const msg = formatGqlErrors(json.errors);
      const retryAfterSec = readRetryAfter(firstError);
      if (__DEV__) {
        // Surface the gateway's class-validator constraint array (lifted
        // into extensions.validationErrors by errorFormatter in dev mode)
        // so the offending field is visible without tailing server stdout.
        const validationErrors = firstError?.extensions?.validationErrors;
        console.warn(`[GraphQL] ${operationName} GraphQL error`, {
          code,
          retryAfterSec,
          message: msg,
          validationErrors,
          variables,
        });
      }
      handleAuthFailure(code);
      throw new GraphQLClientError(`${operationName} failed: ${msg}`, {
        code,
        httpStatus: res.status,
        retryAfterSec,
      });
    }

    if (!json.data) {
      if (__DEV__) console.warn(`[GraphQL] ${operationName} returned no data`);
      throw new GraphQLClientError(
        `${operationName} failed: No data returned from server`,
        { httpStatus: res.status },
      );
    }

    if (__DEV__) console.log(`[GraphQL] ${operationName} success`);
    return json.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new GraphQLClientError(
        `${operationName} timed out while connecting to ${API_URL}`,
        { code: "NETWORK_TIMEOUT" },
      );
    }
    if (error instanceof Error && error.message === "Network request failed") {
      throw new GraphQLClientError(
        `${operationName} network request failed while connecting to ${API_URL}`,
        { code: "NETWORK_FAILED" },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ── Auth Queries/Mutations ──

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

// ── Presigned (direct-to-S3) upload ──

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

// ── Reading Queries/Mutations ──

// ``recordedBy`` is null when the patient entered the reading themselves;
// set when a linked caregiver saved it on the patient's behalf. Drives the
// attribution captions in history / history-list / reading-detail.
export const GQL_READINGS = `
  query Readings($limit: Int, $offset: Int, $patientId: ID) {
    readings(limit: $limit, offset: $offset, patientId: $patientId) {
      id userId clientId systolic diastolic pulse status measuredAt s3Key notes createdAt
      recordedBy { id firstname lastname }
    }
  }
`;

export const GQL_CREATE_READING = `
  mutation CreateReading($input: CreateReadingInput!) {
    createReading(input: $input) {
      id userId clientId systolic diastolic pulse status measuredAt s3Key notes createdAt
      recordedBy { id firstname lastname }
    }
  }
`;

export const GQL_DELETE_READING = `
  mutation DeleteReading($id: Int!) {
    deleteReading(id: $id)
  }
`;

// ── Post Queries/Mutations ──

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

// ── Comment Queries/Mutations ──

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

// ── Alert Queries/Mutations ──

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

// ── Caregiver Queries/Mutations ──

const CAREGIVER_LINK_FIELDS = `
  caregiverId
  patientId
  relationship
  caregiverName
  caregiverPhone
  patientName
  patientPhone
  status
  respondedAt
`;

export const GQL_CAREGIVER_LINKS = `
  query CaregiverLinks {
    caregiverLinks { ${CAREGIVER_LINK_FIELDS} }
  }
`;

export const GQL_MY_PATIENTS = `
  query MyPatients {
    myPatients {
      id firstname lastname phone avatar dob relationship weight height
    }
  }
`;

export const GQL_PENDING_INVITES = `
  query MyPendingInvites {
    myPendingInvites { ${CAREGIVER_LINK_FIELDS} }
  }
`;

export const GQL_RESPOND_INVITE = `
  mutation RespondToCaregiverInvite($caregiverId: String!, $accept: Boolean!) {
    respondToCaregiverInvite(caregiverId: $caregiverId, accept: $accept) { ${CAREGIVER_LINK_FIELDS} }
  }
`;

export const GQL_ADD_CAREGIVER_PATIENT = `
  mutation AddCaregiverPatient($patientPhone: String!, $relationship: String!) {
    addCaregiverPatient(patientPhone: $patientPhone, relationship: $relationship) { ${CAREGIVER_LINK_FIELDS} }
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
