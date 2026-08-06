/**
 * The three representations of a reading, and every conversion between them.
 *
 *   GraphQL payload  ──▶ Reading ◀── drizzle row (mirror)
 *                                ◀── drizzle row (queue)
 *
 * All of it lives here so the rules stay in one place: ISO strings in the
 * database (text sorts correctly, so `ORDER BY measured_at DESC` needs no
 * conversion), `Date` in the domain, `null` at the storage boundary and
 * `undefined` inside the app.
 */
import type { PendingReading, Reading as ReadingRow } from '@/database';

import { parseStatus } from './status';
import type { Reading } from '../types';

export type ReadingPayload = {
  id: number;
  userId: string;
  clientId: string | null;
  systolic: number;
  diastolic: number;
  pulse: number;
  status: string;
  measuredAt: string;
  s3Key: string | null;
  notes: string | null;
  createdAt: string;
  /** Mirrors the gateway's `ReadingRecordedByType` — two name fields, not one. */
  recordedBy: { id: string; firstname: string; lastname: string } | null;
};

/** "สมชาย ใจดี". Empty when the gateway sends two blank strings. */
const fullName = (person: { firstname: string; lastname: string }): string | undefined =>
  `${person.firstname ?? ''} ${person.lastname ?? ''}`.trim() || undefined;

/**
 * The list key. Stable across the queue→mirror promotion, because it is
 * derived from `clientId` when there is one — a key that changed the moment a
 * row synced would remount the card the user is looking at.
 */
export const readingKey = (input: { clientId?: string | null; remoteId?: number | null }): string =>
  input.clientId ? `client:${input.clientId}` : `remote:${input.remoteId}`;

const optional = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

/** Server payload → domain. Always `synced`; the server has it by definition. */
export function readingFromGql(payload: ReadingPayload): Reading {
  return {
    key: readingKey({ clientId: payload.clientId, remoteId: payload.id }),
    remoteId: payload.id,
    clientId: optional(payload.clientId),
    userId: payload.userId,
    systolic: payload.systolic,
    diastolic: payload.diastolic,
    pulse: payload.pulse,
    measuredAt: new Date(payload.measuredAt),
    status: parseStatus(payload.status),
    notes: optional(payload.notes),
    s3Key: optional(payload.s3Key),
    recordedById: optional(payload.recordedBy?.id),
    recordedByName: payload.recordedBy ? fullName(payload.recordedBy) : undefined,
    createdAt: new Date(payload.createdAt),
    syncState: 'synced',
  };
}

/** Server payload → the row written into the mirror. */
export function mirrorRowFromGql(payload: ReadingPayload, syncedAt = new Date()): ReadingRow {
  return {
    remoteId: payload.id,
    clientId: payload.clientId,
    userId: payload.userId,
    systolic: payload.systolic,
    diastolic: payload.diastolic,
    pulse: payload.pulse,
    measuredAt: new Date(payload.measuredAt).toISOString(),
    status: parseStatus(payload.status),
    notes: payload.notes,
    s3Key: payload.s3Key,
    // A fetched row has no local photo. This column stays null unless this
    // device took the picture, and the mirror upsert preserves it.
    imageUri: null,
    imageId: null,
    recordedById: payload.recordedBy?.id ?? null,
    recordedByName: payload.recordedBy ? (fullName(payload.recordedBy) ?? null) : null,
    createdAt: new Date(payload.createdAt).toISOString(),
    updatedAt: null,
    syncedAt: syncedAt.toISOString(),
  };
}

/**
 * Domain → mirror row, for a reading that came back confirmed.
 *
 * Used by the fetch reconcile, which already has `Reading`s in hand. Throws
 * on a reading with no `remoteId`: the mirror is keyed by the server's id, so
 * a row without one is a programming error, not a runtime condition to paper
 * over with a placeholder that would collide with a real id later.
 */
export function mirrorRowFromReading(reading: Reading, syncedAt = new Date()): ReadingRow {
  if (reading.remoteId == null) {
    throw new Error(`cannot mirror a reading with no remoteId: ${reading.key}`);
  }

  return {
    remoteId: reading.remoteId,
    clientId: reading.clientId ?? null,
    userId: reading.userId,
    systolic: reading.systolic,
    diastolic: reading.diastolic,
    pulse: reading.pulse,
    measuredAt: reading.measuredAt.toISOString(),
    status: reading.status,
    notes: reading.notes ?? null,
    s3Key: reading.s3Key ?? null,
    // Not overwritten by the mirror upsert — the local photo, if this device
    // took one, is preserved there.
    imageUri: null,
    imageId: null,
    recordedById: reading.recordedById ?? null,
    recordedByName: reading.recordedByName ?? null,
    createdAt: reading.createdAt.toISOString(),
    updatedAt: null,
    syncedAt: syncedAt.toISOString(),
  };
}

/** Mirror row → domain. */
export function readingFromMirrorRow(row: ReadingRow): Reading {
  return {
    key: readingKey(row),
    remoteId: row.remoteId,
    clientId: optional(row.clientId),
    userId: row.userId,
    systolic: row.systolic,
    diastolic: row.diastolic,
    pulse: row.pulse,
    measuredAt: new Date(row.measuredAt),
    status: parseStatus(row.status),
    notes: optional(row.notes),
    imageUri: optional(row.imageUri),
    imageId: optional(row.imageId),
    s3Key: optional(row.s3Key),
    recordedById: optional(row.recordedById),
    recordedByName: optional(row.recordedByName),
    createdAt: new Date(row.createdAt),
    syncState: 'synced',
  };
}

/**
 * Queue row → domain.
 *
 * `remoteId` is absent by construction — a row still in the queue has never
 * been confirmed. `attempts` and `lastError` come along so a debug screen can
 * show why something is stuck without a second query.
 */
export function readingFromQueueRow(row: PendingReading): Reading {
  return {
    key: readingKey({ clientId: row.clientId }),
    clientId: row.clientId,
    userId: row.userId,
    systolic: row.systolic,
    diastolic: row.diastolic,
    pulse: row.pulse,
    measuredAt: new Date(row.measuredAt),
    status: parseStatus(row.status),
    notes: optional(row.notes),
    imageUri: optional(row.imageUri),
    imageId: optional(row.imageId),
    recordedById: optional(row.recordedById),
    recordedByName: optional(row.recordedByName),
    createdAt: new Date(row.createdAt),
    syncState: 'queued',
    attempts: row.attempts,
    lastError: optional(row.lastError),
  };
}

/** Newest measurement first — what every screen wants. */
export const byMeasuredAtDesc = (a: Reading, b: Reading): number =>
  b.measuredAt.getTime() - a.measuredAt.getTime();

/**
 * Merges the queue and the mirror into the single list a screen renders.
 *
 * Deduplicates on `clientId`: between the moment a create succeeds and the
 * moment the queue row is deleted, the same measurement exists in both
 * tables. Showing it twice, for that window, in the list the user is
 * watching, is exactly the kind of thing that makes someone doubt the app is
 * counting correctly. The **synced** copy wins, because it carries the
 * server's id and its `s3Key`.
 */
export function mergeReadings(synced: Reading[], queued: Reading[]): Reading[] {
  const syncedClientIds = new Set(
    synced.map((reading) => reading.clientId).filter((id): id is string => Boolean(id)),
  );

  const stillQueued = queued.filter(
    (reading) => !reading.clientId || !syncedClientIds.has(reading.clientId),
  );

  return [...synced, ...stillQueued].sort(byMeasuredAtDesc);
}
