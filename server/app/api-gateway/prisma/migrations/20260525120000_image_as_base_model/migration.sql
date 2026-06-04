-- PR1 — Image as base model for S3-backed image storage
--
-- Make Image the canonical record for every S3 object the gateway tracks.
-- The reading no longer carries its own s3Key; instead Image points to its
-- reading via Image.reading_id, so an Image row exists from the moment
-- confirmImageUpload completes — well before any BP reading is saved.
--
-- Why this matters:
--   * Closes the orphan window between S3 PUT and reading-create (cleanup
--     cron can now find unattached Image rows and prune both the row and
--     the S3 object together).
--   * Gives ai-service a place to write imageQualityScore back into the DB.
--   * Removes the s3Key duplication between images.s3_key and
--     blood_pressure_readings.s3_key (single source of truth).
--
-- Pre-launch assumption: alerts, blood_pressure_readings, and images are
-- empty in every environment. The DELETEs below are intentional — if you
-- have local dev rows, prisma migrate dev resets them at this stage.
--
-- onDelete behavior: Image.reading_id uses ON DELETE SET NULL. A reading
-- being deleted must NOT cascade-delete the image (the image survives so
-- audit and cleanup can run); the inverse direction (image deleted) does
-- not touch the reading, since the reading no longer holds the s3Key.

-- 1. Purge dependent rows so the column ops below succeed cleanly.
DELETE FROM "alerts";
DELETE FROM "blood_pressure_readings";
DELETE FROM "images";

-- 2. Drop legacy sync-status tracking. Image rows are only created AFTER a
--    successful upload now, so the state machine collapses to a single
--    state and the column becomes dead weight.
DROP INDEX IF EXISTS "images_sync_status_idx";
ALTER TABLE "images" DROP COLUMN "sync_status";
ALTER TABLE "images" DROP COLUMN "synced_at";
DROP TYPE "ImageSyncStatus";

-- 3. device_name becomes nullable. Today it is hardcoded to
--    'blood-pressure-monitor' at the service layer; once the client starts
--    sending real device names the placeholder goes away. Nullable keeps
--    the column honest for the transition.
ALTER TABLE "images" ALTER COLUMN "device_name" DROP NOT NULL;

-- 4. s3_key becomes unique. One DB row per S3 object — guarantees the
--    invariant that lookup-by-key is unambiguous and lets cleanup queries
--    use the index directly.
CREATE UNIQUE INDEX "images_s3_key_key" ON "images"("s3_key");

-- 5. updated_at on Image was already added in
--    20260513130000_pr_b_schema_cleanup (B4), so it is intentionally
--    omitted here. Prisma's @updatedAt still manages writes via schema.prisma.

-- 6. reading_id FK on Image. @unique enforces 1:0..1 — one image attaches
--    to at most one reading, one reading owns at most one image. Drop
--    the unique index later if multi-image becomes a real requirement.
ALTER TABLE "images" ADD COLUMN "reading_id" INTEGER;
CREATE UNIQUE INDEX "images_reading_id_key" ON "images"("reading_id");
ALTER TABLE "images"
  ADD CONSTRAINT "images_reading_id_fkey"
  FOREIGN KEY ("reading_id")
  REFERENCES "blood_pressure_readings"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- 7. Replace the bare user_id index with a composite that matches the
--    actual query pattern: "list this user's images, newest first"
--    (used by cleanup and any future user-facing image history view).
DROP INDEX IF EXISTS "images_user_id_idx";
CREATE INDEX "images_user_id_uploaded_at_idx"
  ON "images" ("user_id", "uploaded_at" DESC);

-- 8. blood_pressure_readings: drop the duplicated s3_key column. The
--    reading reaches its image via the back-relation (images.reading_id).
ALTER TABLE "blood_pressure_readings" DROP COLUMN "s3_key";
