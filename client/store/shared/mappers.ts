import {
  AppAlert,
  BloodPressureReading,
  CaregiverLink,
  CaregiverLinkStatus,
  CommunityPost,
  PatientSummary,
  PostComment,
  User,
  UserRole,
} from "@/types";
import type {
  AlertGql,
  CaregiverLinkGql,
  CommentGql,
  PatientSummaryGql,
  PostGql,
  ReadingGql,
  UserGql,
} from "@/types/graphql";
import { toLocalPostId, toLocalReadingId } from "./client-id";

const VALID_ROLES: ReadonlySet<UserRole> = new Set([
  "patient",
  "caregiver",
  "developer",
]);

const parseRole = (raw: unknown): UserRole | undefined =>
  typeof raw === "string" && VALID_ROLES.has(raw as UserRole)
    ? (raw as UserRole)
    : undefined;

const VALID_LINK_STATUS: ReadonlySet<CaregiverLinkStatus> = new Set([
  "pending",
  "accepted",
  "rejected",
]);

const parseLinkStatus = (raw: unknown): CaregiverLinkStatus =>
  typeof raw === "string" && VALID_LINK_STATUS.has(raw as CaregiverLinkStatus)
    ? (raw as CaregiverLinkStatus)
    : "accepted";

export const sortReadingsDesc = (items: BloodPressureReading[]) =>
  [...items].sort(
    (a, b) =>
      new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
  );

export const sortPostsDesc = (items: CommunityPost[]) =>
  [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

export const sortCommentsAsc = (items: PostComment[]) =>
  [...items].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

// Maps a SQLite row to the in-memory shape. Handles both pending rows
// (remoteId NULL → id = `local-<pk>`) and synced mirror rows (remoteId set
// → id = `String(remoteId)`), so hydration can return both in one pass.
export const readingFromRow = (row: {
  id: number;
  userId: string;
  clientId: string | null;
  remoteId: number | null;
  syncStatus: "pending" | "pending-image" | "synced";
  systolic: number;
  diastolic: number;
  pulse: number;
  measuredAt: string;
  imageUri: string | null;
  notes: string | null;
  status: string;
  createdAt: string;
}): BloodPressureReading => {
  const imageUri = row.imageUri ?? undefined;
  if (row.syncStatus === "synced" && row.remoteId != null) {
    return {
      id: String(row.remoteId),
      userId: row.userId,
      clientId: row.clientId ?? undefined,
      systolic: Number(row.systolic),
      diastolic: Number(row.diastolic),
      pulse: Number(row.pulse),
      measuredAt: new Date(row.measuredAt),
      imageUri,
      notes: row.notes ?? undefined,
      status: row.status as BloodPressureReading["status"],
      createdAt: new Date(row.createdAt),
      syncStatus: "synced",
    };
  }
  return {
    id: toLocalReadingId(row.id),
    userId: row.userId,
    clientId: row.clientId ?? undefined,
    systolic: Number(row.systolic),
    diastolic: Number(row.diastolic),
    pulse: Number(row.pulse),
    measuredAt: new Date(row.measuredAt),
    imageUri,
    notes: row.notes ?? undefined,
    status: row.status as BloodPressureReading["status"],
    createdAt: new Date(row.createdAt),
    syncStatus: row.syncStatus,
  };
};

// Deprecated alias: kept so existing callers in the sync slice don't churn.
// New code should use readingFromRow.
export const readingFromPending = readingFromRow;

export const postFromLocal = (row: {
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

export const userFromGql = (u: UserGql): User => ({
  id: u.id,
  firstname: u.firstname,
  lastname: u.lastname,
  phone: u.phone,
  email: u.email ?? undefined,
  avatar: u.avatar ?? undefined,
  role: parseRole(u.role),
  createdAt: new Date(u.createdAt),
  dob: u.dob ? new Date(u.dob) : undefined,
  gender: u.gender ?? undefined,
  weight: typeof u.weight === "number" ? u.weight : undefined,
  height: typeof u.height === "number" ? u.height : undefined,
  congenitalDisease: u.congenitalDisease ?? undefined,
});

export const readingFromGql = (r: ReadingGql): BloodPressureReading => ({
  id: String(r.id),
  userId: r.userId,
  clientId: r.clientId ?? undefined,
  systolic: r.systolic,
  diastolic: r.diastolic,
  pulse: r.pulse,
  status: r.status,
  measuredAt: new Date(r.measuredAt),
  imageUri: r.s3Key ?? undefined,
  notes: r.notes ?? undefined,
  createdAt: r.createdAt ? new Date(r.createdAt) : undefined,
  syncStatus: "synced",
});

export const postFromGql = (p: PostGql): CommunityPost => ({
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

export const commentFromGql = (c: CommentGql): PostComment => ({
  id: String(c.id),
  postId: String(c.postId),
  userId: c.userId,
  parentId:
    c.parentId === null || c.parentId === undefined
      ? undefined
      : String(c.parentId),
  userName: c.userName,
  userAvatar: c.userAvatar ?? undefined,
  content: c.content,
  likes: c.likes ?? 0,
  replies: c.replies ?? 0,
  createdAt: new Date(c.createdAt),
  updatedAt: c.updatedAt ? new Date(c.updatedAt) : undefined,
  isLiked: c.isLiked ?? false,
});

export const alertFromGql = (a: AlertGql): AppAlert => ({
  id: String(a.id),
  userId: a.userId,
  bpReadingId: String(a.bpReadingId),
  alertMessage: a.alertMessage,
  alertLevel: a.alertLevel,
  readAt: a.readAt ? new Date(a.readAt) : undefined,
  createdAt: new Date(a.createdAt),
  reading: a.reading
    ? {
        id: String(a.reading.id),
        systolic: a.reading.systolic,
        diastolic: a.reading.diastolic,
        pulse: a.reading.pulse,
        status: a.reading.status,
        measuredAt: new Date(a.reading.measuredAt),
        s3Key: a.reading.s3Key ?? undefined,
      }
    : undefined,
});

export const caregiverLinkFromGql = (
  link: CaregiverLinkGql,
): CaregiverLink => ({
  caregiverId: link.caregiverId,
  patientId: link.patientId,
  relationship: link.relationship,
  caregiverName: link.caregiverName,
  caregiverPhone: link.caregiverPhone,
  patientName: link.patientName,
  patientPhone: link.patientPhone,
  status: parseLinkStatus(link.status),
  respondedAt: link.respondedAt ? new Date(link.respondedAt) : undefined,
});

export const patientSummaryFromGql = (p: PatientSummaryGql): PatientSummary => ({
  id: p.id,
  firstname: p.firstname,
  lastname: p.lastname,
  phone: p.phone,
  avatar: p.avatar ?? undefined,
  dob: p.dob ? new Date(p.dob) : undefined,
  relationship: p.relationship ?? undefined,
  weight: typeof p.weight === "number" ? p.weight : undefined,
  height: typeof p.height === "number" ? p.height : undefined,
});
