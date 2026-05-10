// GraphQL wire formats — what the API gateway actually returns over the wire,
// before the store transforms them into the domain types in `./index.ts`.
// Keep these aligned with the GQL_* operation strings in `constants/api.ts`.

import type {
  AppAlert,
  BloodPressureReading,
  CaregiverLink,
  CommunityPost,
  PostComment,
  User,
} from "./index";

// ── Scalars ──
// GraphQL emits dates as ISO strings; the store turns them into Date.
type Iso = string;

// ── Auth / Profile ──

export interface UserGql {
  id: string;
  firstname: string;
  lastname: string;
  phone: string;
  email?: string | null;
  avatar?: string | null;
  role?: string | null;
  createdAt: Iso;
  dob?: Iso | null;
  gender?: User["gender"] | null;
  weight?: number | null;
  height?: number | null;
  congenitalDisease?: string | null;
}

export interface AuthPayloadGql {
  token: string;
  user: UserGql;
}

export interface MeQuery {
  me: UserGql;
}

export interface LoginMutation {
  login: AuthPayloadGql;
}

export interface RegisterMutation {
  register: AuthPayloadGql;
}

export interface UpdateProfileMutation {
  updateProfile: UserGql;
}

export interface ChangePasswordMutation {
  changePassword: boolean;
}

export interface LogoutMutation {
  logout: boolean;
}

export interface LogoutAllDevicesMutation {
  logoutAllDevices: boolean;
}

export interface DeleteMyDataMutation {
  deleteMyData: boolean;
}

// ── Sessions ──

export interface LoginSessionGql {
  id: string;
  deviceLabel?: string | null;
  userAgent?: string | null;
  isActive: boolean;
  revokedAt?: Iso | null;
  lastActiveAt: Iso;
  createdAt: Iso;
}

export interface LoginSessionsQuery {
  loginSessions: LoginSessionGql[];
}

// ── Readings ──

export interface ReadingGql {
  id: string | number;
  userId: string;
  clientId?: string | null;
  systolic: number;
  diastolic: number;
  pulse: number;
  status: BloodPressureReading["status"];
  measuredAt: Iso;
  imageUri?: string | null;
  notes?: string | null;
  createdAt?: Iso | null;
}

export interface ReadingsQuery {
  readings: ReadingGql[];
}

export interface CreateReadingMutation {
  createReading: ReadingGql;
}

export interface DeleteReadingMutation {
  deleteReading: boolean;
}

// ── Posts ──

export interface PostGql {
  id: string | number;
  userId: string;
  clientId?: string | null;
  userName: string;
  userAvatar?: string | null;
  content: string;
  category: CommunityPost["category"];
  likes?: number | null;
  comments?: number | null;
  createdAt: Iso;
  updatedAt?: Iso | null;
  isLiked?: boolean | null;
}

export interface PostsQuery {
  posts: PostGql[];
}

export interface CreatePostMutation {
  createPost: PostGql;
}

export interface UpdatePostMutation {
  updatePost: boolean;
}

export interface DeletePostMutation {
  deletePost: boolean;
}

export interface ToggleLikeMutation {
  toggleLike: boolean;
}

// ── Comments ──

export interface CommentGql {
  id: string | number;
  postId: string | number;
  userId: string;
  parentId?: string | number | null;
  userName: string;
  userAvatar?: string | null;
  content: string;
  likes?: number | null;
  replies?: number | null;
  createdAt: Iso;
  updatedAt?: Iso | null;
  isLiked?: boolean | null;
}

export interface PostCommentsQuery {
  postComments: CommentGql[];
}

export interface CreateCommentMutation {
  createComment: CommentGql;
}

export interface UpdateCommentMutation {
  updateComment: CommentGql;
}

export interface DeleteCommentMutation {
  deleteComment: boolean;
}

export interface ToggleCommentLikeMutation {
  toggleCommentLike: boolean;
}

// ── Alerts ──

export interface AlertAnalysisGql {
  id: string | number;
  systolic: number;
  diastolic: number;
  pulse: number;
  confidence: number;
  bpLevel: string;
  analysisNote?: string | null;
  analyzedAt: Iso;
  imageUrl?: string | null;
}

export interface AlertGql {
  id: string | number;
  userId: string;
  analysisId: string | number;
  alertMessage: string;
  alertLevel: AppAlert["alertLevel"];
  isRead: boolean | number;
  createdAt: Iso;
  analysis?: AlertAnalysisGql | null;
}

export interface AlertsQuery {
  alerts: AlertGql[];
}

export interface MarkAlertReadMutation {
  markAlertRead: boolean;
}

export interface MarkAllAlertsReadMutation {
  markAllAlertsRead: boolean;
}

// ── Caregivers ──

export interface CaregiverLinkGql extends CaregiverLink {}

export interface CaregiverLinksQuery {
  caregiverLinks: CaregiverLinkGql[];
}

export interface AddCaregiverPatientMutation {
  addCaregiverPatient: CaregiverLinkGql;
}

export interface RemoveCaregiverPatientMutation {
  removeCaregiverPatient: boolean;
}

// ── Helpers ──

/** Pull a human-readable string out of an unknown thrown value. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
};

/** Narrow PostComment["postId"] | similar union to a string. */
export const idToString = (value: string | number): string => String(value);
