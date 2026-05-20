// Queries for the `pending_readings` table.
//
// One table, two roles: offline write queue (syncStatus != 'synced')
// AND local mirror of confirmed server rows (syncStatus = 'synced',
// remoteId set). Promotion is in-place — the row a slice inserted
// optimistically is later flipped to synced, not re-inserted.

import { getDb } from "@/src/core/database/client";
import { pendingReadings } from "@/src/core/database/schema";
import type {
    NewPendingReading,
    PendingReadingRow,
} from "@/src/types/database";
import { and, eq, ne, sql } from "drizzle-orm";

// Returns ONLY rows that still need syncing (queue semantics — used
// by syncPendingReadings). For history rendering use listLocalReadings.
export const listPendingReadings = async (
  userId: string,
): Promise<PendingReadingRow[]> => {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(pendingReadings)
    .where(
      and(
        eq(pendingReadings.userId, userId),
        ne(pendingReadings.syncStatus, "synced"),
      ),
    )
    .orderBy(sql`datetime(${pendingReadings.measuredAt}) DESC`);
};

// Returns every row for the user (pending + synced mirror). Used by
// hydratePendingReadings so the UI can render history offline / before
// fetchReadings completes.
export const listLocalReadings = async (
  userId: string,
): Promise<PendingReadingRow[]> => {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(pendingReadings)
    .where(eq(pendingReadings.userId, userId))
    .orderBy(sql`datetime(${pendingReadings.measuredAt}) DESC`);
};

export const insertPendingReading = async (
  row: Omit<NewPendingReading, "id" | "remoteId" | "updatedAt"> & {
    syncStatus: NonNullable<NewPendingReading["syncStatus"]>;
  },
): Promise<number | null> => {
  const db = getDb();
  if (!db) return null;
  const [inserted] = await db
    .insert(pendingReadings)
    .values({
      ...row,
      remoteId: null,
      updatedAt: row.createdAt,
    })
    .returning({ id: pendingReadings.id });
  return inserted?.id ?? null;
};

export const deletePendingReading = async (id: number): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db.delete(pendingReadings).where(eq(pendingReadings.id, id));
};

// Upsert a server-confirmed row into the local mirror. Keyed by clientId
// first (so the row we inserted optimistically gets promoted to synced
// in-place), falling back to remoteId for rows that originated on
// another device.
export const upsertSyncedReading = async (
  row: Omit<NewPendingReading, "id" | "syncStatus" | "updatedAt"> & {
    remoteId: number;
  },
): Promise<void> => {
  const db = getDb();
  if (!db) return;
  const updatedAt = new Date().toISOString();

  if (row.clientId) {
    const existing = await db
      .select({ id: pendingReadings.id })
      .from(pendingReadings)
      .where(eq(pendingReadings.clientId, row.clientId))
      .limit(1);
    if (existing[0]) {
      await db
        .update(pendingReadings)
        .set({
          userId: row.userId,
          remoteId: row.remoteId,
          syncStatus: "synced",
          systolic: row.systolic,
          diastolic: row.diastolic,
          pulse: row.pulse,
          measuredAt: row.measuredAt,
          imageUri: row.imageUri,
          notes: row.notes,
          status: row.status,
          updatedAt,
        })
        .where(eq(pendingReadings.id, existing[0].id));
      return;
    }
  }

  const existingByRemote = await db
    .select({ id: pendingReadings.id })
    .from(pendingReadings)
    .where(eq(pendingReadings.remoteId, row.remoteId))
    .limit(1);
  if (existingByRemote[0]) {
    await db
      .update(pendingReadings)
      .set({
        userId: row.userId,
        clientId: row.clientId,
        syncStatus: "synced",
        systolic: row.systolic,
        diastolic: row.diastolic,
        pulse: row.pulse,
        measuredAt: row.measuredAt,
        imageUri: row.imageUri,
        notes: row.notes,
        status: row.status,
        updatedAt,
      })
      .where(eq(pendingReadings.id, existingByRemote[0].id));
    return;
  }

  await db.insert(pendingReadings).values({
    ...row,
    syncStatus: "synced",
    updatedAt,
  });
};

// Flip a previously-pending row to synced and stamp the server id. Used
// when createReading / syncPendingReadings completes a queued row.
export const markReadingSynced = async (
  localId: number,
  remoteId: number,
  imageUri: string | null,
): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db
    .update(pendingReadings)
    .set({
      remoteId,
      syncStatus: "synced",
      imageUri,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(pendingReadings.id, localId));
};

export const deleteSyncedReadingByRemoteId = async (
  userId: string,
  remoteId: number,
): Promise<void> => {
  const db = getDb();
  if (!db) return;
  await db
    .delete(pendingReadings)
    .where(
      and(
        eq(pendingReadings.userId, userId),
        eq(pendingReadings.remoteId, remoteId),
      ),
    );
};
