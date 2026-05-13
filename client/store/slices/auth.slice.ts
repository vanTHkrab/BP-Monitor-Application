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
} from "@/constants/api";
import { clearUserLocalData } from "@/data/local-db";
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
import { authErrorToThai } from "../shared/error-format";
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

export interface AuthSlice {
  // ── State ──
  isAuthenticated: boolean;
  user: User | null;
  authInitialized: boolean;
  authToken: string | null;
  authErrorCode: string | null;
  authErrorMessage: string | null;
  authErrorRawMessage: string | null;
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
  uploadMyAvatar: (avatarUri: string) => Promise<boolean>;
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
) => ({
  isAuthenticated: false,
  user: null,
  authInitialized: false,
  authToken: null,
  authErrorCode: null,
  authErrorMessage: null,
  authErrorRawMessage: null,
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

  clearAuthError: () => {
    set({
      authErrorCode: null,
      authErrorMessage: null,
      authErrorRawMessage: null,
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

  uploadMyAvatar: async (avatarUri) => {
    const token = get().authToken;
    if (!token || !get().user) return false;

    try {
      const uploadedAvatarUri = await uploadImageViaPresign({
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
});
