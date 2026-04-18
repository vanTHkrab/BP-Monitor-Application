// constants/api.ts — GraphQL client helper for communicating with NestJS API Gateway
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_API_PORT = "3000";
const REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_LAN_API_HOST = "10.200.27.158";

const isLoopbackHost = (host: string) =>
  host === "127.0.0.1" ||
  host === "localhost" ||
  host === "::1" ||
  host === "0.0.0.0";

const getExpoHostUri = (): string | null => {
  const possibleHostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any)?.expoGoConfig?.debuggerHost ||
    (Constants as any)?.expoGoConfig?.hostUri ||
    (Constants as any)?.manifest2?.extra?.expoClient?.hostUri ||
    (Constants as any)?.manifest?.debuggerHost ||
    (Constants as any)?.platform?.hostUri ||
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

  if (Platform.OS === "android") {
    return `http://${DEFAULT_LAN_API_HOST}:${DEFAULT_API_PORT}/graphql`;
  }

  return `http://${DEFAULT_LAN_API_HOST}:${DEFAULT_API_PORT}/graphql`;
};

const API_URL = resolveApiUrl();

const TOKEN_KEY = "bp:auth-token";

// ── Token Management ──

export const setAuthToken = async (token: string): Promise<void> => {
  await AsyncStorage.setItem(TOKEN_KEY, token);
};

export const getAuthToken = async (): Promise<string | null> => {
  return AsyncStorage.getItem(TOKEN_KEY);
};

export const clearAuthToken = async (): Promise<void> => {
  await AsyncStorage.removeItem(TOKEN_KEY);
};

// ── GraphQL Request ──

interface GqlResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export async function graphqlRequest<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
  token?: string | null,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    const json: GqlResponse<T> = await res.json();

    if (json.errors && json.errors.length > 0) {
      const msg = json.errors.map((e) => e.message).join("; ");
      throw new Error(msg);
    }

    if (!json.data) {
      throw new Error("No data returned from server");
    }

    return json.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Network request timed out while connecting to ${API_URL}`,
      );
    }
    if (error instanceof Error && error.message === "Network request failed") {
      throw new Error(`Network request failed while connecting to ${API_URL}`);
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

// ── Reading Queries/Mutations ──

export const GQL_READINGS = `
  query Readings($limit: Int, $offset: Int) {
    readings(limit: $limit, offset: $offset) {
      id userId clientId systolic diastolic pulse status measuredAt imageUri notes createdAt
    }
  }
`;

export const GQL_CREATE_READING = `
  mutation CreateReading($input: CreateReadingInput!) {
    createReading(input: $input) {
      id userId clientId systolic diastolic pulse status measuredAt imageUri notes createdAt
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
      id userId clientId userName userAvatar content category likes createdAt updatedAt isLiked
    }
  }
`;

export const GQL_CREATE_POST = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      id userId clientId userName userAvatar content category likes createdAt updatedAt isLiked
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
