import { getBPStatus } from "@/constants/colors";
import {
  clearAuthToken,
  GQL_ADD_CAREGIVER_PATIENT,
  GQL_ALERTS,
  GQL_CAREGIVER_LINKS,
  GQL_CHANGE_PASSWORD,
  GQL_CREATE_COMMENT,
  GQL_DELETE_MY_DATA,
  GQL_DELETE_COMMENT,
  getGraphqlEndpoint,
  getAuthToken,
  graphqlRequest,
  GQL_CREATE_POST,
  GQL_CREATE_READING,
  GQL_DELETE_POST,
  GQL_DELETE_READING,
  GQL_LOGIN,
  GQL_LOGIN_SESSIONS,
  GQL_LOGOUT_ALL_DEVICES,
  GQL_MARK_ALERT_READ,
  GQL_MARK_ALL_ALERTS_READ,
  GQL_ME,
  GQL_POST_COMMENTS,
  GQL_POSTS,
  GQL_READINGS,
  GQL_REGISTER,
  GQL_REMOVE_CAREGIVER_PATIENT,
  GQL_TOGGLE_COMMENT_LIKE,
  GQL_TOGGLE_LIKE,
  GQL_UPDATE_COMMENT,
  GQL_UPDATE_POST,
  GQL_UPDATE_PROFILE,
  setAuthToken,
} from "@/constants/api";
import {
  clearUserLocalData,
  deleteLocalPost,
  deletePendingPostAction,
  deletePendingReading,
  insertLocalPost,
  insertPendingReading,
  listLocalPosts,
  listPendingPostActions,
  listPendingReadings,
  queuePendingPostAction,
  updateLocalPost,
} from "@/data/local-db";
import {
  AppAlert,
  BloodPressureReading,
  CaregiverLink,
  CommunityPost,
  FontSizePreference,
  LoginSession,
  PostComment,
  User,
} from "@/types";
import type {
  AddCaregiverPatientMutation,
  AlertGql,
  AlertsQuery,
  AuthPayloadGql,
  CaregiverLinkGql,
  CaregiverLinksQuery,
  ChangePasswordMutation,
  CommentGql,
  CreateCommentMutation,
  CreatePostMutation,
  CreateReadingMutation,
  DeleteCommentMutation,
  DeleteMyDataMutation,
  DeletePostMutation,
  LoginMutation,
  LoginSessionsQuery,
  LogoutAllDevicesMutation,
  MeQuery,
  PostCommentsQuery,
  PostGql,
  PostsQuery,
  ReadingGql,
  ReadingsQuery,
  RegisterMutation,
  RemoveCaregiverPatientMutation,
  ToggleCommentLikeMutation,
  ToggleLikeMutation,
  UpdateCommentMutation,
  UpdateProfileMutation,
  UserGql,
} from "@/types/graphql";
import { errorMessage } from "@/types/graphql";
import { uploadImageToS3 } from "@/utils/upload-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { create } from "zustand";

interface AppState {
  // Auth
  isAuthenticated: boolean;
  user: User | null;
  authInitialized: boolean;
  authToken: string | null;
  authErrorCode: string | null;
  authErrorMessage: string | null;
  authErrorRawMessage: string | null;

  // Blood Pressure
  readings: BloodPressureReading[];
  isOnline: boolean;

  // Community
  posts: CommunityPost[];
  commentsByPostId: Record<string, PostComment[]>;
  alerts: AppAlert[];
  caregiverLinks: CaregiverLink[];
  sessions: LoginSession[];

  // Theme
  themePreference: "light" | "dark";
  themeHydrated: boolean;
  fontSizePreference: FontSizePreference;

  // Security
  hideSensitiveData: boolean;
  sensitiveDataUnlocked: boolean;

  // Actions
  initAuth: () => Promise<void>;
  login: (phone: string, password: string) => Promise<boolean>;
  register: (input: {
    firstname: string;
    lastname: string;
    phone: string;
    password: string;
    email?: string;
    dob?: string;
    gender?: User["gender"];
    weight?: number;
    height?: number;
    congenitalDisease?: string;
    avatarUri?: string | null;
  }) => Promise<boolean>;
  logout: () => void;
  clearAuthError: () => void;

  updateMyProfile: (input: {
    firstname?: string;
    lastname?: string;
    phone?: string;
    email?: string;
    dob?: string;
    gender?: User["gender"];
    weight?: number;
    height?: number;
    congenitalDisease?: string;
    avatar?: string;
  }) => Promise<boolean>;
  fetchMyProfile: () => Promise<boolean>;
  uploadMyAvatar: (avatarUri: string) => Promise<boolean>;

  createReading: (input: {
    systolic: number;
    diastolic: number;
    pulse: number;
    measuredAt?: Date;
    imageUri?: string;
    notes?: string;
  }) => Promise<boolean>;

  deleteReading: (id: string) => Promise<void>;

  setNetworkStatus: (isOnline: boolean) => void;
  hydratePendingReadings: () => Promise<void>;
  syncPendingReadings: () => Promise<void>;
  hydratePendingPosts: () => Promise<void>;
  syncPendingPosts: () => Promise<void>;

  fetchReadings: () => Promise<void>;
  fetchPosts: () => Promise<void>;
  fetchAlerts: () => Promise<void>;
  markAlertRead: (id: string) => Promise<void>;
  markAllAlertsRead: () => Promise<void>;
  fetchCaregiverLinks: () => Promise<void>;
  addCaregiverPatient: (input: {
    patientPhone: string;
    relationship: string;
  }) => Promise<boolean>;
  removeCaregiverPatient: (input: {
    caregiverId: string;
    patientId: string;
  }) => Promise<boolean>;

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
  updateComment: (input: { commentId: string; content: string }) => Promise<boolean>;
  deleteComment: (postId: string, commentId: string) => Promise<boolean>;
  toggleCommentLike: (postId: string, commentId: string) => Promise<void>;
  fetchSessions: () => Promise<void>;
  logoutAllDevices: () => Promise<boolean>;
  deleteAllMyData: () => Promise<boolean>;

  hydrateTheme: () => Promise<void>;
  setThemePreference: (pref: "light" | "dark") => Promise<void>;
  hydrateAccessibilityPreferences: () => Promise<void>;
  setFontSizePreference: (pref: FontSizePreference) => Promise<void>;
  hydrateSecurityPreferences: () => Promise<void>;
  setHideSensitiveData: (enabled: boolean) => Promise<void>;
  unlockSensitiveData: (password: string) => Promise<boolean>;
  lockSensitiveData: () => void;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<boolean>;
}

const THEME_STORAGE_KEY = "bp:theme-preference";
const FONT_SIZE_PREFERENCE_KEY = "bp:font-size-preference";
const HIDE_SENSITIVE_DATA_KEY = "bp:hide-sensitive-data";

const isLocalReadingId = (id: string) => id.startsWith("local-");
const toLocalReadingId = (localId: number) => `local-${localId}`;
const parseLocalReadingId = (id: string) => Number(id.replace("local-", ""));

const isLocalPostId = (id: string) => id.startsWith("local-post-");
const toLocalPostId = (localId: number) => `local-post-${localId}`;
const parseLocalPostId = (id: string) => Number(id.replace("local-post-", ""));

// Combine timestamp + multiple Math.random() chunks for ~120 bits of entropy.
// Cryptographically weak but collision-resistant enough for offline-sync IDs;
// switch to expo-crypto's randomUUID() if/when that dependency is added.
const randomChunk = () => Math.random().toString(36).slice(2, 12).padStart(10, "0");
const createClientId = (prefix: string, userId: string) =>
  `${prefix}-${userId}-${Date.now().toString(36)}-${randomChunk()}${randomChunk()}`;

// Dev-only logger so silent catch blocks no longer swallow errors in development
// while staying quiet in production builds.
const logWarn = (
  scope: string,
  message: string,
  error?: unknown,
  details?: Record<string, unknown>,
) => {
  if (!__DEV__) return;
  const errorDetails =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : error
        ? { error }
        : {};
  console.warn(`[${scope}] ${message}`, { ...details, ...errorDetails });
};

const communityDebug = (
  message: string,
  details?: Record<string, unknown>,
) => {
  if (!__DEV__) return;
  console.log(`[Community] ${message}`, details ?? {});
};

const communityWarn = (
  message: string,
  error?: unknown,
  details?: Record<string, unknown>,
) => logWarn("Community", message, error, details);

const getDeviceLabel = () =>
  `${
    Platform.OS === "ios"
      ? "iPhone"
      : Platform.OS === "android"
        ? "Android"
        : "Web"
  } App`;

// Promise-based mutex: concurrent callers await the same in-flight sync
// instead of racing past a boolean flag and double-syncing.
let syncReadingsPromise: Promise<void> | null = null;
let syncPostsPromise: Promise<void> | null = null;

const sortReadingsDesc = (items: BloodPressureReading[]) =>
  [...items].sort(
    (a, b) =>
      new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
  );

const sortPostsDesc = (items: CommunityPost[]) =>
  [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

const sortCommentsAsc = (items: PostComment[]) =>
  [...items].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

const readingFromPending = (row: {
  id: number;
  userId: string;
  clientId: string | null;
  systolic: number;
  diastolic: number;
  pulse: number;
  measuredAt: string;
  imageUri: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}): BloodPressureReading => ({
  id: toLocalReadingId(row.id),
  userId: row.userId,
  clientId: row.clientId ?? undefined,
  systolic: Number(row.systolic),
  diastolic: Number(row.diastolic),
  pulse: Number(row.pulse),
  measuredAt: new Date(row.measuredAt),
  imageUri: row.imageUri ?? undefined,
  notes: row.notes ?? undefined,
  status: row.status as BloodPressureReading["status"],
  createdAt: new Date(row.createdAt),
});

const postFromLocal = (row: {
  id: number;
  userId: string;
  clientId: string | null;
  userName: string;
  userAvatar: string | null;
  content: string;
  category: string;
  createdAt: string;
}): CommunityPost => ({
  id: toLocalPostId(row.id),
  userId: row.userId,
  clientId: row.clientId ?? undefined,
  userName: row.userName,
  userAvatar: row.userAvatar ?? undefined,
  content: row.content,
  category: (row.category as CommunityPost["category"]) || "general",
  likes: 0,
  comments: 0,
  createdAt: new Date(row.createdAt),
  isLiked: false,
  syncStatus: "local",
});

const userFromGql = (u: UserGql): User => ({
  id: u.id,
  firstname: u.firstname,
  lastname: u.lastname,
  phone: u.phone,
  email: u.email ?? undefined,
  avatar: u.avatar ?? undefined,
  role: u.role ?? undefined,
  createdAt: new Date(u.createdAt),
  dob: u.dob ? new Date(u.dob) : undefined,
  gender: u.gender ?? undefined,
  weight: typeof u.weight === "number" ? u.weight : undefined,
  height: typeof u.height === "number" ? u.height : undefined,
  congenitalDisease: u.congenitalDisease ?? undefined,
});

const readingFromGql = (r: ReadingGql): BloodPressureReading => ({
  id: String(r.id),
  userId: r.userId,
  clientId: r.clientId ?? undefined,
  systolic: r.systolic,
  diastolic: r.diastolic,
  pulse: r.pulse,
  status: r.status,
  measuredAt: new Date(r.measuredAt),
  imageUri: r.imageUri ?? undefined,
  notes: r.notes ?? undefined,
  createdAt: r.createdAt ? new Date(r.createdAt) : undefined,
});

const postFromGql = (p: PostGql): CommunityPost => ({
  id: String(p.id),
  userId: p.userId,
  clientId: p.clientId ?? undefined,
  userName: p.userName,
  userAvatar: p.userAvatar ?? undefined,
  content: p.content,
  category: p.category,
  likes: p.likes ?? 0,
  comments: p.comments ?? 0,
  createdAt: new Date(p.createdAt),
  isLiked: p.isLiked ?? false,
});

const commentFromGql = (c: CommentGql): PostComment => ({
  id: String(c.id),
  postId: String(c.postId),
  userId: c.userId,
  parentId:
    c.parentId === null || c.parentId === undefined ? undefined : String(c.parentId),
  userName: c.userName,
  userAvatar: c.userAvatar ?? undefined,
  content: c.content,
  likes: c.likes ?? 0,
  replies: c.replies ?? 0,
  createdAt: new Date(c.createdAt),
  updatedAt: c.updatedAt ? new Date(c.updatedAt) : undefined,
  isLiked: c.isLiked ?? false,
});

const alertFromGql = (a: AlertGql): AppAlert => ({
  id: String(a.id),
  userId: a.userId,
  analysisId: String(a.analysisId),
  alertMessage: a.alertMessage,
  alertLevel: a.alertLevel,
  isRead: Boolean(a.isRead),
  createdAt: new Date(a.createdAt),
  analysis: a.analysis
    ? {
        id: String(a.analysis.id),
        systolic: a.analysis.systolic,
        diastolic: a.analysis.diastolic,
        pulse: a.analysis.pulse,
        confidence: a.analysis.confidence,
        bpLevel: a.analysis.bpLevel,
        analysisNote: a.analysis.analysisNote ?? undefined,
        analyzedAt: new Date(a.analysis.analyzedAt),
        imageUrl: a.analysis.imageUrl ?? undefined,
      }
    : undefined,
});

const caregiverLinkFromGql = (link: CaregiverLinkGql): CaregiverLink => ({
  caregiverId: link.caregiverId,
  patientId: link.patientId,
  relationship: link.relationship,
  caregiverName: link.caregiverName,
  caregiverPhone: link.caregiverPhone,
  patientName: link.patientName,
  patientPhone: link.patientPhone,
});

// Heuristic: a string is "Thai-friendly" if it contains any Thai characters.
// We let those pass through unchanged (they came from the backend's localized
// validation messages). Anything else gets normalized to a generic Thai
// message so we don't leak raw English GraphQL errors into the UI.
const containsThai = (text: string) => /[฀-๿]/.test(text);

const authErrorToThai = (msg?: string): string => {
  if (!msg) return "เกิดข้อผิดพลาด กรุณาลองใหม่";
  if (msg.includes("Network request timed out")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จภายในเวลาที่กำหนด กรุณาตรวจสอบว่าโทรศัพท์เข้าถึงเครื่องที่รัน Nest ได้";
  }
  if (msg.includes("Network request failed")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบ IP, Wi-Fi และพอร์ตของ Nest GraphQL";
  }
  if (containsThai(msg)) return msg;
  return "เกิดข้อผิดพลาด กรุณาลองใหม่";
};

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  isAuthenticated: false,
  user: null,
  authInitialized: false,
  authToken: null,
  authErrorCode: null,
  authErrorMessage: null,
  authErrorRawMessage: null,
  readings: [],
  isOnline: true,
  posts: [],
  commentsByPostId: {},
  alerts: [],
  caregiverLinks: [],
  sessions: [],
  themePreference: "light",
  themeHydrated: false,
  fontSizePreference: "medium",
  hideSensitiveData: false,
  sensitiveDataUnlocked: false,

  // ── Auth ──

  initAuth: async () => {
    try {
      const token = await getAuthToken();
      if (!token) {
        set({ authInitialized: true });
        return;
      }

      const data = await graphqlRequest<MeQuery>(GQL_ME, undefined, token);
      const user = userFromGql(data.me);
      set({
        isAuthenticated: true,
        user,
        authToken: token,
        authInitialized: true,
        sensitiveDataUnlocked: false,
      });

      // Fetch data
      void get().fetchReadings();
      void get().fetchPosts();
      void get().fetchAlerts();
      void get().fetchCaregiverLinks();
      void get().fetchSessions();
      void get().hydratePendingReadings();
      void get().hydratePendingPosts();
    } catch (error) {
      logWarn("Auth", "initAuth failed; clearing token", error);
      await clearAuthToken();
      set({ authInitialized: true, authToken: null });
    }
  },

  login: async (phone: string, password: string) => {
    try {
      set({
        authErrorCode: null,
        authErrorMessage: null,
        authErrorRawMessage: null,
      });
      const data = await graphqlRequest<LoginMutation>(GQL_LOGIN, {
        input: { phone, password, deviceLabel: getDeviceLabel() },
      });
      const { token, user } = data.login;
      await setAuthToken(token);
      set({
        isAuthenticated: true,
        user: userFromGql(user),
        authToken: token,
        sensitiveDataUnlocked: false,
      });

      void get().fetchReadings();
      void get().fetchPosts();
      void get().fetchAlerts();
      void get().fetchCaregiverLinks();
      void get().fetchSessions();
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "auth/login-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  register: async (input) => {
    try {
      set({
        authErrorCode: null,
        authErrorMessage: null,
        authErrorRawMessage: null,
      });

      const data = await graphqlRequest<RegisterMutation>(GQL_REGISTER, {
        input: {
          firstname: input.firstname,
          lastname: input.lastname,
          phone: input.phone,
          password: input.password,
          email: input.email || undefined,
          dob: input.dob || undefined,
          gender: input.gender || undefined,
          weight: input.weight,
          height: input.height,
          congenitalDisease: input.congenitalDisease || undefined,
          avatar: undefined,
        },
      });

      const { token, user } = data.register;
      await setAuthToken(token);
      set({
        isAuthenticated: true,
        user: userFromGql(user),
        authToken: token,
        sensitiveDataUnlocked: false,
      });

      if (input.avatarUri) {
        void get().uploadMyAvatar(input.avatarUri);
      }

      void get().fetchReadings();
      void get().fetchPosts();
      void get().fetchAlerts();
      void get().fetchCaregiverLinks();
      void get().fetchSessions();
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "auth/register-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  logout: () => {
    void clearAuthToken();
    set({
      isAuthenticated: false,
      user: null,
      authToken: null,
      readings: [],
      posts: [],
      commentsByPostId: {},
      alerts: [],
      caregiverLinks: [],
      sessions: [],
      sensitiveDataUnlocked: false,
    });
  },

  clearAuthError: () => {
    set({
      authErrorCode: null,
      authErrorMessage: null,
      authErrorRawMessage: null,
    });
  },

  // ── Profile ──

  updateMyProfile: async (input) => {
    const token = get().authToken;
    if (!token || !get().user) return false;

    try {
      const data = await graphqlRequest<UpdateProfileMutation>(
        GQL_UPDATE_PROFILE,
        { input },
        token,
      );
      set({ user: userFromGql(data.updateProfile) });
      return true;
    } catch (error) {
      console.warn("[S3 upload] profile upload failed", error);
      return false;
    }
  },

  fetchMyProfile: async () => {
    const token = get().authToken;
    if (!token) return false;

    try {
      const data = await graphqlRequest<MeQuery>(GQL_ME, undefined, token);
      set({ user: userFromGql(data.me) });
      return true;
    } catch (error) {
      logWarn("Profile", "fetchMyProfile failed", error);
      return false;
    }
  },

  uploadMyAvatar: async (avatarUri: string) => {
    const token = get().authToken;
    if (!token || !get().user) return false;

    try {
      const uploadedAvatarUri = await uploadImageToS3({
        uri: avatarUri,
        kind: "profile",
        token,
      });
      const data = await graphqlRequest<UpdateProfileMutation>(
        GQL_UPDATE_PROFILE,
        { input: { avatar: uploadedAvatarUri } },
        token,
      );
      set({ user: userFromGql(data.updateProfile) });
      return true;
    } catch (error) {
      logWarn("Profile", "uploadMyAvatar failed", error);
      return false;
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const token = get().authToken;
    if (!token) return false;

    try {
      await graphqlRequest<ChangePasswordMutation>(
        GQL_CHANGE_PASSWORD,
        { input: { currentPassword, newPassword } },
        token,
      );
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "auth/change-password-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  // ── Readings ──

  fetchReadings: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<ReadingsQuery>(
        GQL_READINGS,
        { limit: 200, offset: 0 },
        token,
      );
      const remote = data.readings.map(readingFromGql);
      const pending = get().readings.filter((r) => isLocalReadingId(r.id));
      set({ readings: sortReadingsDesc([...pending, ...remote]) });
    } catch (error) {
      logWarn("Readings", "fetchReadings failed", error);
    }
  },

  fetchAlerts: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<AlertsQuery>(
        GQL_ALERTS,
        { limit: 100, offset: 0, unreadOnly: false },
        token,
      );
      set({ alerts: data.alerts.map(alertFromGql) });
    } catch (error) {
      logWarn("Alerts", "fetchAlerts failed", error);
    }
  },

  markAlertRead: async (id: string) => {
    const token = get().authToken;
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === id ? { ...alert, isRead: true } : alert,
      ),
    }));

    if (!token) return;

    try {
      await graphqlRequest(GQL_MARK_ALERT_READ, { id: Number(id) }, token);
    } catch (error) {
      logWarn("Alerts", "markAlertRead failed; keeping optimistic state", error, { id });
    }
  },

  markAllAlertsRead: async () => {
    const token = get().authToken;
    set((state) => ({
      alerts: state.alerts.map((alert) => ({ ...alert, isRead: true })),
    }));

    if (!token) return;

    try {
      await graphqlRequest(GQL_MARK_ALL_ALERTS_READ, undefined, token);
    } catch (error) {
      logWarn("Alerts", "markAllAlertsRead failed; keeping optimistic state", error);
    }
  },

  fetchCaregiverLinks: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<CaregiverLinksQuery>(
        GQL_CAREGIVER_LINKS,
        undefined,
        token,
      );
      set({
        caregiverLinks: data.caregiverLinks.map(caregiverLinkFromGql),
      });
    } catch (error) {
      logWarn("Caregivers", "fetchCaregiverLinks failed", error);
    }
  },

  addCaregiverPatient: async ({ patientPhone, relationship }) => {
    const token = get().authToken;
    if (!token) return false;

    try {
      const data = await graphqlRequest<AddCaregiverPatientMutation>(
        GQL_ADD_CAREGIVER_PATIENT,
        {
          patientPhone: patientPhone.trim(),
          relationship: relationship.trim() || "caregiver",
        },
        token,
      );
      const link = caregiverLinkFromGql(data.addCaregiverPatient);
      set((state) => ({
        caregiverLinks: [
          link,
          ...state.caregiverLinks.filter(
            (item) =>
              item.caregiverId !== link.caregiverId ||
              item.patientId !== link.patientId,
          ),
        ],
      }));
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "caregiver/add-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  removeCaregiverPatient: async ({ caregiverId, patientId }) => {
    const token = get().authToken;
    if (!token) return false;

    try {
      const data = await graphqlRequest<RemoveCaregiverPatientMutation>(
        GQL_REMOVE_CAREGIVER_PATIENT,
        { caregiverId, patientId },
        token,
      );
      if (!data.removeCaregiverPatient) return false;

      set((state) => ({
        caregiverLinks: state.caregiverLinks.filter(
          (link) =>
            link.caregiverId !== caregiverId || link.patientId !== patientId,
        ),
      }));
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "caregiver/remove-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  createReading: async (input) => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser) return false;

    const measuredAt = input.measuredAt ?? new Date();
    const systolic = Number(input.systolic);
    const diastolic = Number(input.diastolic);
    const pulse = Number(input.pulse);
    const status = getBPStatus(systolic, diastolic);
    const clientId = createClientId("reading", currentUser.id);
    let imageUri = input.imageUri;
    let imageReadyForRemote = !imageUri || /^https?:\/\//i.test(imageUri);

    if (get().isOnline && token && imageUri && !imageReadyForRemote) {
      try {
        imageUri = await uploadImageToS3({
          uri: imageUri,
          kind: "blood-pressure",
          token,
        });
        imageReadyForRemote = true;
      } catch (error) {
        console.warn(
          "[S3 upload] blood-pressure upload failed; keeping pending reading",
          error,
        );
        imageReadyForRemote = false;
      }
    }

    // Always insert into local pending first
    const pendingId = await insertPendingReading({
      userId: currentUser.id,
      clientId,
      systolic,
      diastolic,
      pulse,
      measuredAt: measuredAt.toISOString(),
      imageUri: imageUri ?? null,
      notes: input.notes ?? null,
      status,
      createdAt: new Date().toISOString(),
    });

    if (pendingId) {
      const localReading: BloodPressureReading = {
        id: toLocalReadingId(pendingId),
        userId: currentUser.id,
        clientId,
        systolic,
        diastolic,
        pulse,
        measuredAt,
        imageUri,
        notes: input.notes,
        status,
        createdAt: new Date(),
      };
      set((state) => ({
        readings: sortReadingsDesc([localReading, ...state.readings]),
      }));
    }

    if (!get().isOnline || !token) return Boolean(pendingId);
    if (!imageReadyForRemote) return Boolean(pendingId);

    try {
      await graphqlRequest(
        GQL_CREATE_READING,
        {
          input: {
            systolic,
            diastolic,
            pulse,
            status,
            measuredAt: measuredAt.toISOString(),
            clientId,
            imageUri: imageUri ?? null,
            notes: input.notes ?? null,
          },
        },
        token,
      );
      if (pendingId) {
        await deletePendingReading(pendingId);
        set((state) => ({
          readings: state.readings.filter(
            (r) => r.id !== toLocalReadingId(pendingId),
          ),
        }));
      }
      void get().fetchReadings();
      void get().fetchAlerts();
      return true;
    } catch (error) {
      logWarn("Readings", "createReading remote failed; kept as pending", error, { clientId });
      return Boolean(pendingId);
    }
  },

  deleteReading: async (id: string) => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser) return;

    if (isLocalReadingId(id)) {
      const localId = parseLocalReadingId(id);
      if (!Number.isNaN(localId)) await deletePendingReading(localId);
      set((state) => ({
        readings: state.readings.filter((r) => r.id !== id),
      }));
      return;
    }

    if (token) {
      try {
        await graphqlRequest(GQL_DELETE_READING, { id: Number(id) }, token);
      } catch (error) {
        logWarn("Readings", "deleteReading remote failed", error, { id });
      }
    }
    set((state) => ({
      readings: state.readings.filter((r) => r.id !== id),
    }));
  },

  setNetworkStatus: (isOnline: boolean) => {
    set({ isOnline });
  },

  hydratePendingReadings: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    const pending = await listPendingReadings(currentUser.id);
    const pendingReadings = pending.map(readingFromPending);
    set((state) => {
      const nonLocal = state.readings.filter((r) => !isLocalReadingId(r.id));
      return {
        readings: sortReadingsDesc([...pendingReadings, ...nonLocal]),
      };
    });
  },

  syncPendingReadings: async () => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser || !token || !get().isOnline) return;
    if (syncReadingsPromise) return syncReadingsPromise;

    syncReadingsPromise = (async () => {
      try {
        const pending = await listPendingReadings(currentUser.id);
        for (const row of pending) {
          try {
            let imageUri = row.imageUri ?? null;
            if (imageUri && !/^https?:\/\//i.test(imageUri)) {
              imageUri = await uploadImageToS3({
                uri: imageUri,
                kind: "blood-pressure",
                token,
              });
            }

            await graphqlRequest(
              GQL_CREATE_READING,
              {
                input: {
                  systolic: row.systolic,
                  diastolic: row.diastolic,
                  pulse: row.pulse,
                  status: row.status,
                  measuredAt: row.measuredAt,
                  clientId: row.clientId || `local-${currentUser.id}-${row.id}`,
                  imageUri,
                  notes: row.notes ?? null,
                },
              },
              token,
            );
            await deletePendingReading(row.id);
            set((state) => ({
              readings: state.readings.filter(
                (r) => r.id !== toLocalReadingId(row.id),
              ),
            }));
          } catch (error) {
            logWarn(
              "Sync",
              "pending blood-pressure reading failed; will retry later",
              error,
              { localId: row.id, clientId: row.clientId },
            );
          }
        }
        void get().fetchReadings();
        void get().fetchAlerts();
      } finally {
        syncReadingsPromise = null;
      }
    })();

    return syncReadingsPromise;
  },

  // ── Posts ──

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
            posts: state.posts.filter((p) => p.id !== toLocalPostId(row.id)),
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

  toggleLike: async (postId: string) => {
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
        communityWarn("createPost remote failed; saving local fallback", error, {
          clientId,
        });
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

  deletePost: async (postId: string) => {
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

  fetchPostComments: async (postId: string) => {
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
      communityDebug("createComment skipped", { postId, reason: "empty-content" });
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

  fetchSessions: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<LoginSessionsQuery>(
        GQL_LOGIN_SESSIONS,
        undefined,
        token,
      );
      set({
        sessions: data.loginSessions.map((session) => ({
          id: session.id,
          deviceLabel: session.deviceLabel ?? undefined,
          userAgent: session.userAgent ?? undefined,
          isActive: Boolean(session.isActive),
          revokedAt: session.revokedAt
            ? new Date(session.revokedAt)
            : undefined,
          lastActiveAt: new Date(session.lastActiveAt),
          createdAt: new Date(session.createdAt),
        })),
      });
    } catch (error) {
      logWarn("Sessions", "fetchSessions failed", error);
    }
  },

  logoutAllDevices: async () => {
    const token = get().authToken;
    if (!token) return false;

    try {
      await graphqlRequest<LogoutAllDevicesMutation>(
        GQL_LOGOUT_ALL_DEVICES,
        undefined,
        token,
      );
      void get().fetchSessions();
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "auth/logout-all-devices-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  deleteAllMyData: async () => {
    const token = get().authToken;
    const currentUser = get().user;
    if (!token || !currentUser) return false;

    try {
      await graphqlRequest<DeleteMyDataMutation>(
        GQL_DELETE_MY_DATA,
        undefined,
        token,
      );
      await clearUserLocalData(currentUser.id);
      set({ readings: [], posts: [], commentsByPostId: {}, alerts: [] });
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "data/delete-all-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  // ── Theme ──

  hydrateTheme: async () => {
    try {
      const raw = await AsyncStorage.getItem(THEME_STORAGE_KEY);
      const pref = raw === "dark" ? "dark" : raw === "light" ? "light" : null;
      set({ themePreference: pref ?? "light", themeHydrated: true });
    } catch {
      set({ themeHydrated: true });
    }
  },

  setThemePreference: async (pref) => {
    set({ themePreference: pref });
    try {
      await AsyncStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      // ignore
    }
  },

  hydrateAccessibilityPreferences: async () => {
    try {
      const raw = await AsyncStorage.getItem(FONT_SIZE_PREFERENCE_KEY);
      if (raw === "xsmall") {
        await AsyncStorage.setItem(FONT_SIZE_PREFERENCE_KEY, "small");
      }
      const normalized =
        raw === "xsmall"
          ? "small"
          : raw === "small" || raw === "large" || raw === "xlarge"
            ? raw
            : "medium";
      set({
        fontSizePreference: normalized,
      });
    } catch {
      set({ fontSizePreference: "medium" });
    }
  },

  setFontSizePreference: async (pref) => {
    set({ fontSizePreference: pref });
    try {
      await AsyncStorage.setItem(FONT_SIZE_PREFERENCE_KEY, pref);
    } catch {
      // ignore
    }
  },

  hydrateSecurityPreferences: async () => {
    try {
      const raw = await AsyncStorage.getItem(HIDE_SENSITIVE_DATA_KEY);
      set({
        hideSensitiveData: raw === "true",
        sensitiveDataUnlocked: false,
      });
    } catch {
      set({ sensitiveDataUnlocked: false });
    }
  },

  setHideSensitiveData: async (enabled) => {
    set({
      hideSensitiveData: enabled,
      sensitiveDataUnlocked: enabled ? false : true,
    });

    try {
      await AsyncStorage.setItem(
        HIDE_SENSITIVE_DATA_KEY,
        enabled ? "true" : "false",
      );
    } catch {
      // ignore
    }
  },

  unlockSensitiveData: async (password) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    try {
      await graphqlRequest<LoginMutation>(GQL_LOGIN, {
        input: {
          phone: currentUser.phone,
          password,
        },
      });
      set({ sensitiveDataUnlocked: true });
      return true;
    } catch (error) {
      const msg = errorMessage(error);
      set({
        authErrorCode: "auth/unlock-sensitive-data-failed",
        authErrorMessage: authErrorToThai(msg),
        authErrorRawMessage: msg,
      });
      return false;
    }
  },

  lockSensitiveData: () => {
    if (get().hideSensitiveData) {
      set({ sensitiveDataUnlocked: false });
    }
  },
}));
