import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * On-device SQLite schema.
 *
 * The old client kept one `pending_readings` table doing two jobs at once —
 * the offline write queue and the mirror of server-confirmed rows — told
 * apart by a `syncStatus` column. Every read then had to remember to filter
 * on it, and forgetting to was a bug that showed up as a patient seeing
 * duplicated or missing history.
 *
 * They are split here. The queue is short-lived and write-heavy; the mirror
 * is long-lived and read-heavy. Splitting lets each one be indexed for what
 * it actually does, and makes "which rows still need sending?" a question
 * about *which table you are in* rather than a predicate you can forget.
 *
 * The cost: confirming a sync now writes to two tables, so it has to happen
 * inside a transaction. That is the one invariant this design depends on.
 */

/**
 * Readings captured on device that the server has not accepted yet.
 *
 * Rows are deleted once confirmed — they do not linger with a status flag.
 * `clientId` is the primary key rather than a surrogate autoincrement so a
 * retried submit cannot enqueue the same reading twice.
 */
export const pendingReadings = sqliteTable(
  'pending_readings',
  {
    clientId: text('client_id').primaryKey(),
    userId: text('user_id').notNull(),

    systolic: real('systolic').notNull(),
    diastolic: real('diastolic').notNull(),
    pulse: real('pulse').notNull(),
    /** ISO 8601. Sorts correctly as text, so no numeric conversion needed. */
    measuredAt: text('measured_at').notNull(),
    status: text('status').notNull(),
    notes: text('notes'),

    /** Local file URI of the captured photo, before upload. */
    imageUri: text('image_uri'),
    /**
     * Server-side Image.id, set once confirmUploadImage succeeds but before
     * the reading itself is submitted. Lets an interrupted flow resume
     * without re-uploading the photo.
     */
    imageId: integer('image_id'),

    /** Caregiver attribution, when someone logs a reading for the patient. */
    recordedById: text('recorded_by_id'),
    recordedByName: text('recorded_by_name'),

    createdAt: text('created_at').notNull(),
    /** Submit attempts so far — lets the sync loop back off a poison row. */
    attempts: integer('attempts').notNull().default(0),
    /** Last failure message, for the debug screen. Not shown to patients. */
    lastError: text('last_error'),
  },
  (table) => [index('pending_readings_user_idx').on(table.userId)],
);

/**
 * Mirror of readings the server has confirmed.
 *
 * Exists so a reinstall followed by an offline launch still shows history.
 * Authoritative state lives in Postgres — this is a cache and may be
 * rebuilt from `fetchReadings` at any time.
 */
export const readings = sqliteTable(
  'readings',
  {
    /** Server id. Primary key here because the server owns identity. */
    remoteId: integer('remote_id').primaryKey(),
    /**
     * The clientId this row was submitted under, when it originated on this
     * device. Null for rows first seen via a server fetch.
     */
    clientId: text('client_id'),
    userId: text('user_id').notNull(),

    systolic: real('systolic').notNull(),
    diastolic: real('diastolic').notNull(),
    pulse: real('pulse').notNull(),
    measuredAt: text('measured_at').notNull(),
    status: text('status').notNull(),
    notes: text('notes'),

    imageUri: text('image_uri'),
    imageId: integer('image_id'),

    recordedById: text('recorded_by_id'),
    recordedByName: text('recorded_by_name'),

    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    /** When this device last wrote the row. Used to age out the mirror. */
    syncedAt: text('synced_at').notNull(),
  },
  (table) => [
    // The history screen's only query: this user's readings, newest first.
    index('readings_user_measured_idx').on(table.userId, table.measuredAt),
    // Lets a sync confirmation find the row it just promoted from the queue.
    uniqueIndex('readings_client_id_unique').on(table.clientId),
  ],
);

export type PendingReading = typeof pendingReadings.$inferSelect;
export type NewPendingReading = typeof pendingReadings.$inferInsert;
export type Reading = typeof readings.$inferSelect;
export type NewReading = typeof readings.$inferInsert;
