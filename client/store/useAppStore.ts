import { getBPStatus } from "@/constants/colors";
import {
  clearAuthToken,
  GQL_CHANGE_PASSWORD,
  GQL_DELETE_MY_DATA,
  getAuthToken,
  graphqlRequest,
  GQL_CREATE_POST,
  GQL_CREATE_READING,
  GQL_DELETE_POST,
  GQL_DELETE_READING,
  GQL_LOGIN,
  GQL_LOGIN_SESSIONS,
  GQL_LOGOUT_ALL_DEVICES,
  GQL_ME,
  GQL_POSTS,
  GQL_READINGS,
  GQL_REGISTER,
  GQL_TOGGLE_LIKE,
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
  BloodPressureReading,
  CommunityPost,
  FontSizePreference,
  LoginSession,
  User,
} from "@/types";
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

const createClientId = (prefix: string, userId: string) =>
  `${prefix}-${userId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getDeviceLabel = () =>
  `${
    Platform.OS === "ios"
      ? "iPhone"
      : Platform.OS === "android"
        ? "Android"
        : "Web"
  } App`;

let syncReadingsInFlight = false;
let syncPostsInFlight = false;

const sortReadingsDesc = (items: BloodPressureReading[]) =>
  [...items].sort(
    (a, b) =>
      new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
  );

const sortPostsDesc = (items: CommunityPost[]) =>
  [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
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

const userFromGql = (u: any): User => ({
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

const readingFromGql = (r: any): BloodPressureReading => ({
  id: String(r.id),
  userId: r.userId,
  clientId: r.clientId ?? undefined,
  systolic: r.systolic,
  diastolic: r.diastolic,
  pulse: r.pulse,
  status: r.status as BloodPressureReading["status"],
  measuredAt: new Date(r.measuredAt),
  imageUri: r.imageUri ?? undefined,
  notes: r.notes ?? undefined,
});

const postFromGql = (p: any): CommunityPost => ({
  id: String(p.id),
  userId: p.userId,
  clientId: p.clientId ?? undefined,
  userName: p.userName,
  userAvatar: p.userAvatar ?? undefined,
  content: p.content,
  category: p.category as CommunityPost["category"],
  likes: p.likes ?? 0,
  comments: 0,
  createdAt: new Date(p.createdAt),
  isLiked: p.isLiked ?? false,
});

const authErrorToThai = (msg?: string): string => {
  if (!msg) return "เกิดข้อผิดพลาด กรุณาลองใหม่";
  if (msg.includes("Network request timed out")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จภายในเวลาที่กำหนด กรุณาตรวจสอบว่าโทรศัพท์เข้าถึงเครื่องที่รัน Nest ได้";
  }
  if (msg.includes("Network request failed")) {
    return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบ IP, Wi-Fi และพอร์ตของ Nest GraphQL";
  }
  if (msg.includes("ถูกใช้งานแล้ว")) return msg;
  if (msg.includes("ไม่ถูกต้อง")) return msg;
  if (msg.includes("ไม่พบผู้ใช้")) return msg;
  if (msg.includes("อีเมล")) return msg;
  if (msg.includes("รหัสผ่านปัจจุบัน")) return msg;
  return msg;
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

      const data = await graphqlRequest<{ me: any }>(GQL_ME, undefined, token);
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
      void get().fetchSessions();
      void get().hydratePendingReadings();
      void get().hydratePendingPosts();
    } catch {
      // Token invalid or expired
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
      const data = await graphqlRequest<{
        login: { token: string; user: any };
      }>(GQL_LOGIN, {
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
      void get().fetchSessions();
      return true;
    } catch (error: any) {
      const msg = error?.message || "";
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

      const data = await graphqlRequest<{
        register: { token: string; user: any };
      }>(GQL_REGISTER, {
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
          avatar: input.avatarUri || undefined,
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

      void get().fetchReadings();
      void get().fetchPosts();
      void get().fetchSessions();
      return true;
    } catch (error: any) {
      const msg = error?.message || "";
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
      const data = await graphqlRequest<{ updateProfile: any }>(
        GQL_UPDATE_PROFILE,
        { input },
        token,
      );
      set({ user: userFromGql(data.updateProfile) });
      return true;
    } catch {
      return false;
    }
  },

  uploadMyAvatar: async (avatarUri: string) => {
    const token = get().authToken;
    if (!token || !get().user) return false;

    try {
      // For now, store avatar URL directly (local URI)
      const data = await graphqlRequest<{ updateProfile: any }>(
        GQL_UPDATE_PROFILE,
        { input: { avatar: avatarUri } },
        token,
      );
      set({ user: userFromGql(data.updateProfile) });
      return true;
    } catch {
      return false;
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    const token = get().authToken;
    if (!token) return false;

    try {
      await graphqlRequest<{ changePassword: boolean }>(
        GQL_CHANGE_PASSWORD,
        { input: { currentPassword, newPassword } },
        token,
      );
      return true;
    } catch (error: any) {
      const msg = error?.message || "";
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
      const data = await graphqlRequest<{ readings: any[] }>(
        GQL_READINGS,
        { limit: 200, offset: 0 },
        token,
      );
      const remote = data.readings.map(readingFromGql);
      const pending = get().readings.filter((r) => isLocalReadingId(r.id));
      set({ readings: sortReadingsDesc([...pending, ...remote]) });
    } catch {
      // silently fail
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

    // Always insert into local pending first
    const pendingId = await insertPendingReading({
      userId: currentUser.id,
      clientId,
      systolic,
      diastolic,
      pulse,
      measuredAt: measuredAt.toISOString(),
      imageUri: input.imageUri ?? null,
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
        imageUri: input.imageUri,
        notes: input.notes,
        status,
      };
      set((state) => ({
        readings: sortReadingsDesc([localReading, ...state.readings]),
      }));
    }

    if (!get().isOnline || !token) return Boolean(pendingId);

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
            imageUri: input.imageUri ?? null,
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
      return true;
    } catch {
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
      } catch {
        // ignore
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
    if (syncReadingsInFlight) return;
    syncReadingsInFlight = true;

    try {
      const pending = await listPendingReadings(currentUser.id);
      for (const row of pending) {
        try {
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
                imageUri: row.imageUri ?? null,
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
        } catch {
          // keep pending for retry
        }
      }
      void get().fetchReadings();
    } finally {
      syncReadingsInFlight = false;
    }
  },

  // ── Posts ──

  fetchPosts: async () => {
    try {
      const token = get().authToken;
      const data = await graphqlRequest<{ posts: any[] }>(
        GQL_POSTS,
        { limit: 100, offset: 0 },
        token,
      );
      const remotePosts = data.posts.map(postFromGql);
      const localPosts = get().posts.filter((p) => isLocalPostId(p.id));
      set({ posts: sortPostsDesc([...localPosts, ...remotePosts]) });
    } catch {
      // silently fail
    }
  },

  hydratePendingPosts: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    const localRows = await listLocalPosts(currentUser.id);
    const localPosts = localRows.map(postFromLocal);
    set((state) => {
      const remotePosts = state.posts.filter((p) => !isLocalPostId(p.id));
      return { posts: sortPostsDesc([...localPosts, ...remotePosts]) };
    });
  },

  syncPendingPosts: async () => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser || !token || !get().isOnline) return;
    if (syncPostsInFlight) return;
    syncPostsInFlight = true;

    try {
      const localRows = await listLocalPosts(currentUser.id);
      for (const row of localRows) {
        try {
          const docId = row.clientId || `local-post-${row.userId}-${row.id}`;
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
        } catch {
          // keep local post for retry
        }
      }

      const pendingActions = await listPendingPostActions(currentUser.id);
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
        } catch {
          // keep pending action for retry
        }
      }

      void get().fetchPosts();
    } finally {
      syncPostsInFlight = false;
    }
  },

  toggleLike: async (postId: string) => {
    const token = get().authToken;
    if (!token || !get().isOnline) return;

    try {
      await graphqlRequest(GQL_TOGGLE_LIKE, { postId: Number(postId) }, token);
      // Optimistic update
      set((state) => ({
        posts: state.posts.map((p) =>
          p.id === postId
            ? {
                ...p,
                isLiked: !p.isLiked,
                likes: p.isLiked ? p.likes - 1 : p.likes + 1,
              }
            : p,
        ),
      }));
    } catch {
      // ignore
    }
  },

  createPost: async ({ content, category }) => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser) return false;

    const trimmed = content.trim();
    if (!trimmed) return false;

    const createdAt = new Date();
    const clientId = createClientId("post", currentUser.id);
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

    if (!get().isOnline || !token) return Boolean(localId);
    if (!localId) return false;

    try {
      await graphqlRequest(
        GQL_CREATE_POST,
        { input: { content: trimmed, category, clientId } },
        token,
      );
      await deleteLocalPost(localId);
      set((state) => ({
        posts: state.posts.filter((p) => p.id !== toLocalPostId(localId)),
      }));
      void get().fetchPosts();
      return true;
    } catch {
      return true;
    }
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
    } catch {
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
    } catch {
      return false;
    }
  },

  fetchSessions: async () => {
    const token = get().authToken;
    if (!token) return;

    try {
      const data = await graphqlRequest<{ loginSessions: any[] }>(
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
    } catch {
      // ignore
    }
  },

  logoutAllDevices: async () => {
    const token = get().authToken;
    if (!token) return false;

    try {
      await graphqlRequest<{ logoutAllDevices: boolean }>(
        GQL_LOGOUT_ALL_DEVICES,
        undefined,
        token,
      );
      void get().fetchSessions();
      return true;
    } catch (error: any) {
      const msg = error?.message || "";
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
      await graphqlRequest<{ deleteMyData: boolean }>(
        GQL_DELETE_MY_DATA,
        undefined,
        token,
      );
      await clearUserLocalData(currentUser.id);
      set({ readings: [], posts: [] });
      return true;
    } catch (error: any) {
      const msg = error?.message || "";
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
      set({
        fontSizePreference:
          raw === "xsmall" ||
          raw === "small" ||
          raw === "large" ||
          raw === "xlarge"
            ? raw
            : "medium",
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
      await graphqlRequest<{ login: { token: string; user: any } }>(GQL_LOGIN, {
        input: {
          phone: currentUser.phone,
          password,
        },
      });
      set({ sensitiveDataUnlocked: true });
      return true;
    } catch (error: any) {
      const msg = error?.message || "";
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
