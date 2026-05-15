import {
  GQL_CHANGE_PASSWORD,
  GQL_DELETE_MY_DATA,
  GQL_LOGIN,
  GQL_LOGIN_SESSIONS,
  GQL_LOGOUT,
  GQL_LOGOUT_ALL_DEVICES,
  GQL_ME,
  GQL_REGISTER,
  GQL_UPDATE_PROFILE,
  clearAuthToken,
  getAuthToken,
  graphqlRequest,
  setAuthToken,
  setUnauthenticatedHandler,
} from "@/constants/api";
import {
  clearUserLocalData,
  deletePendingAvatarUpload,
  getPendingAvatarUpload,
  upsertPendingAvatarUpload,
} from "@/data/local-db";
import { LoginSession, User } from "@/types";
import type {
  ChangePasswordMutation,
  DeleteMyDataMutation,
  LoginMutation,
  LoginSessionsQuery,
  LogoutAllDevicesMutation,
  LogoutMutation,
  MeQuery,
  RegisterMutation,
  UpdateProfileMutation,
} from "@/types/graphql";
import { errorMessage } from "@/types/graphql";
import { uploadImageViaPresign } from "@/utils/upload-image";
import { Platform } from "react-native";
import type { StateCreator } from "zustand";
import {
  type AuthErrorField,
  authErrorToThai,
  formatAuthError,
} from "../shared/error-format";
import { logWarn } from "../shared/log";
import { userFromGql } from "../shared/mappers";
import type { AppState } from "../use-app-store";

const getDeviceLabel = () =>
  `${
    Platform.OS === "ios"
      ? "iPhone"
      : Platform.OS === "android"
        ? "Android"
        : "Web"
  } App`;

// Promise-based mutex matching the readings/posts sync pattern. Concurrent
// callers (NetInfo edge, AppState change, manual save) all await the same
// in-flight upload instead of racing past a boolean flag.
let syncAvatarPromise: Promise<void> | null = null;

export interface AuthSlice {
  // ── State ──
  isAuthenticated: boolean;
  user: User | null;
  authInitialized: boolean;
  authToken: string | null;
  authErrorCode: string | null;
  /** Final user-facing Thai message. Never includes raw English or codes. */
  authErrorMessage: string | null;
  /** Original error message kept for dev logs / Sentry — never shown in UI. */
  authErrorRawMessage: string | null;
  /** Which input the login/register error attaches to, for inline UI. */
  authErrorField: AuthErrorField;
  /** Seconds the user must wait before the next login attempt (HTTP 429). */
  authErrorRetryAfterSec: number | null;
  sessions: LoginSession[];

  // ── Auth actions ──
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
  logout: () => Promise<void>;
  /**
   * Wipe local auth state when the server has already rejected our token
   * (401 / UNAUTHENTICATED). Skips the server revoke that `logout()` does —
   * the token is dead anyway, calling logout with it just produces noise.
   * Triggered by the GraphQL transports via `setUnauthenticatedHandler`.
   */
  handleSessionExpired: () => Promise<void>;
  clearAuthError: () => void;

  // ── Profile actions ──
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
  /**
   * Queue an avatar pick for upload. Updates `user.avatar` to the local URI
   * immediately (optimistic) and persists a row in `pending_avatar_uploads`
   * so the choice survives an app kill. Returns `true` once the queue write
   * succeeds — the actual S3 upload runs asynchronously via
   * `syncPendingAvatar`. Caller does not need to await network success.
   */
  uploadMyAvatar: (avatarUri: string) => Promise<boolean>;
  /** Restore optimistic avatar state from SQLite on app start. */
  hydratePendingAvatar: () => Promise<void>;
  /** Flush the queued avatar to S3 + gateway; safe to call concurrently. */
  syncPendingAvatar: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<boolean>;

  // ── Session actions ──
  fetchSessions: () => Promise<void>;
  logoutAllDevices: () => Promise<boolean>;
  deleteAllMyData: () => Promise<boolean>;
}

export const createAuthSlice: StateCreator<AppState, [], [], AuthSlice> = (
  set,
  get,
) => {
  // Install the session-expired handler exactly once when the store is
  // composed. The GraphQL transports in constants/api.ts and lib/graphql-client.ts
  // call `fireUnauthenticated()` when the server rejects our token; that
  // routes here so we can wipe state without needing an import cycle back
  // into the store.
  setUnauthenticatedHandler(() => {
    void get().handleSessionExpired();
  });

  return {
  isAuthenticated: false,
  user: null,
  authInitialized: false,
  authToken: null,
  authErrorCode: null,
  authErrorMessage: null,
  authErrorRawMessage: null,
  authErrorField: null,
  authErrorRetryAfterSec: null,
  sessions: [],

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
      // Avatar hydration runs *after* the server `me` set above, so the
      // local URI overrides the stale remote one if a previous pick is
      // still queued — same precedence as the readings hydrator.
      await get().hydratePendingAvatar();
    } catch (error) {
      logWarn("Auth", "initAuth failed; clearing token", error);
      await clearAuthToken();
      set({ authInitialized: true, authToken: null });
    }
  },

  login: async (phone, password) => {
    try {
      set({
        authErrorCode: null,
        authErrorMessage: null,
        authErrorRawMessage: null,
        authErrorField: null,
        authErrorRetryAfterSec: null,
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
      const view = formatAuthError(error, {
        context: "login",
        fallback: "เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง",
      });
      set({
        authErrorCode: "auth/login-failed",
        authErrorMessage: view.message,
        authErrorRawMessage: errorMessage(error),
        authErrorField: view.field,
        authErrorRetryAfterSec: view.retryAfterSec,
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
        authErrorField: null,
        authErrorRetryAfterSec: null,
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
        // After Commit 1, uploadMyAvatar is optimistic + queue-backed:
        // it persists the pick to SQLite and kicks the sync mutex in the
        // background. Awaiting it just gates on the local enqueue (a
        // memory write + a single SQLite row), so the user lands on
        // /(tabs) with their picked photo already showing — and the
        // upload retries from the queue if the network drops on the way.
        await get().uploadMyAvatar(input.avatarUri);
      }

      void get().fetchReadings();
      void get().fetchPosts();
      void get().fetchAlerts();
      void get().fetchCaregiverLinks();
      void get().fetchSessions();
      return true;
    } catch (error) {
      const view = formatAuthError(error, {
        context: "register",
        fallback: "ไม่สามารถลงทะเบียนได้ กรุณาตรวจสอบข้อมูลและลองใหม่",
      });
      set({
        authErrorCode: "auth/register-failed",
        authErrorMessage: view.message,
        authErrorRawMessage: errorMessage(error),
        authErrorField: view.field,
        authErrorRetryAfterSec: view.retryAfterSec,
      });
      return false;
    }
  },

  logout: async () => {
    const token = get().authToken;
    // Best-effort revoke on the server. If the network is down or the token
    // is already invalid, still proceed to clear local state — the user
    // pressed "log out" and we have to honor that.
    if (token) {
      try {
        await graphqlRequest<LogoutMutation>(GQL_LOGOUT, undefined, token);
      } catch (error) {
        logWarn("Auth", "logout server revoke failed", error);
      }
    }
    await clearAuthToken();
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

  handleSessionExpired: async () => {
    // Idempotent: concurrent failed requests will all fire the handler;
    // only the first call should clear state. Subsequent calls return
    // early once authToken is null.
    if (!get().authToken) return;
    await clearAuthToken();
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
      // Surface a banner on the login screen so the redirect doesn't look
      // like an unexplained app reset.
      authErrorCode: "auth/session-expired",
      authErrorMessage: "เซสชันของคุณหมดอายุ กรุณาเข้าสู่ระบบใหม่",
      authErrorRawMessage: null,
      authErrorField: null,
      authErrorRetryAfterSec: null,
    });
  },

  clearAuthError: () => {
    set({
      authErrorCode: null,
      authErrorMessage: null,
      authErrorRawMessage: null,
      authErrorField: null,
      authErrorRetryAfterSec: null,
    });
  },

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
      logWarn("Profile", "updateMyProfile failed", error);
      return false;
    }
  },

  fetchMyProfile: async () => {
    const token = get().authToken;
    if (!token) return false;

    try {
      const data = await graphqlRequest<MeQuery>(GQL_ME, undefined, token);
      const serverUser = userFromGql(data.me);
      // Re-focus pulls `me` from the server. If the user picked a new avatar
      // while offline (or even just seconds ago — the sync runs async), the
      // pending queue still holds the local URI. Keep showing that local URI
      // until the sync actually completes; otherwise the picked photo
      // visibly flickers back to the stale one.
      const pending = await getPendingAvatarUpload(serverUser.id);
      set({
        user: pending ? { ...serverUser, avatar: pending.localUri } : serverUser,
      });
      return true;
    } catch (error) {
      logWarn("Profile", "fetchMyProfile failed", error);
      return false;
    }
  },

  uploadMyAvatar: async (avatarUri) => {
    const currentUser = get().user;
    if (!currentUser) return false;

    // Short-circuit: if the URI is already a remote URL (e.g. caller passed
    // the server's canonical URL back through), just persist via the normal
    // updateProfile path with no queue churn.
    if (/^https?:\/\//i.test(avatarUri)) {
      const token = get().authToken;
      if (!token) return false;
      try {
        const data = await graphqlRequest<UpdateProfileMutation>(
          GQL_UPDATE_PROFILE,
          { input: { avatar: avatarUri } },
          token,
        );
        set({ user: userFromGql(data.updateProfile) });
        return true;
      } catch (error) {
        logWarn("Profile", "uploadMyAvatar remote-set failed", error);
        return false;
      }
    }

    // Optimistic: reflect the picked URI in the store immediately so every
    // <Image source={{ uri: user.avatar }}> renders the new photo without
    // waiting for S3.
    set({ user: { ...currentUser, avatar: avatarUri } });

    try {
      await upsertPendingAvatarUpload({
        userId: currentUser.id,
        localUri: avatarUri,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      logWarn("Profile", "queue avatar upload failed", error);
      // Queue write failure means SQLite is broken; the in-memory optimistic
      // state will still let the UI render the picked photo for this session.
    }

    // Fire-and-forget sync; the mutex makes this safe to call from anywhere.
    void get().syncPendingAvatar();
    return true;
  },

  hydratePendingAvatar: async () => {
    const currentUser = get().user;
    if (!currentUser) return;
    try {
      const row = await getPendingAvatarUpload(currentUser.id);
      if (!row) return;
      // Override the server-side avatar with the local URI so the UI shows
      // the picked photo even before sync completes.
      set({ user: { ...currentUser, avatar: row.localUri } });
    } catch (error) {
      logWarn("Profile", "hydratePendingAvatar failed", error);
    }
  },

  syncPendingAvatar: async () => {
    const currentUser = get().user;
    const token = get().authToken;
    if (!currentUser || !token || !get().isOnline) return;
    if (syncAvatarPromise) return syncAvatarPromise;

    syncAvatarPromise = (async () => {
      try {
        const row = await getPendingAvatarUpload(currentUser.id);
        if (!row) return;

        try {
          const uploadedAvatarUri = await uploadImageViaPresign({
            uri: row.localUri,
            kind: "profile",
            token,
          });
          const data = await graphqlRequest<UpdateProfileMutation>(
            GQL_UPDATE_PROFILE,
            { input: { avatar: uploadedAvatarUri } },
            token,
          );
          await deletePendingAvatarUpload(currentUser.id);
          set({ user: userFromGql(data.updateProfile) });
        } catch (error) {
          logWarn(
            "Sync",
            "pending avatar upload failed; will retry later",
            error,
            { userId: currentUser.id },
          );
        }
      } finally {
        syncAvatarPromise = null;
      }
    })();

    return syncAvatarPromise;
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
  };
};
