-- PR B — feature-level schema cleanup
--
-- B1: composite indexes that match real list-query patterns
-- B2: imageUrl / imageUri → s3Key, shrink VARCHAR(2048) → VARCHAR(512)
-- B3: Alert.isRead bool → Alert.readAt timestamp (null = unread)
-- B4: updatedAt on User, BloodPressureReading, Image, Alert
-- B5: CaregiverPatient.relationship → enum RelationshipType
-- B6: createdAt on PostLike, PostCommentLike, CaregiverPatient
--
-- Order matters: rename columns + change types before adding indexes
-- that reference them.

-- ── B5: new enum ─────────────────────────────────────────────────────────────
CREATE TYPE "RelationshipType" AS ENUM (
  'parent', 'child', 'spouse', 'sibling', 'friend',
  'caregiver_professional', 'other'
);

-- ── B2: rename + shrink Image.image_url → s3_key ─────────────────────────────
ALTER TABLE "images" RENAME COLUMN "image_url" TO "s3_key";
ALTER TABLE "images" ALTER COLUMN "s3_key" TYPE VARCHAR(512);

-- ── B2: rename + shrink BloodPressureReading.image_uri → s3_key ──────────────
ALTER TABLE "blood_pressure_readings" RENAME COLUMN "image_uri" TO "s3_key";
ALTER TABLE "blood_pressure_readings" ALTER COLUMN "s3_key" TYPE VARCHAR(512);

-- ── B3: Alert.is_read → Alert.read_at ────────────────────────────────────────
-- Preserve semantics: rows previously marked read get a timestamp (NOW() is a
-- best-effort approximation since the original read time wasn't tracked).
ALTER TABLE "alerts" ADD COLUMN "read_at" TIMESTAMP(3);
UPDATE "alerts" SET "read_at" = NOW() WHERE "is_read" = true;
DROP INDEX IF EXISTS "alerts_user_id_is_read_idx";
ALTER TABLE "alerts" DROP COLUMN "is_read";

-- ── B4: updatedAt on mutable models ──────────────────────────────────────────
-- Default NOW() so existing rows get a sensible initial value.
-- Prisma's @updatedAt manages subsequent writes.
ALTER TABLE "users"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "blood_pressure_readings"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "images"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "alerts"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── B5: CaregiverPatient.relationship VARCHAR → enum ─────────────────────────
-- Pre-launch assumption: caregiver_patient is empty. If you have rows you
-- want to keep, run a manual migration mapping known relationship strings to
-- enum values before applying this migration.
DELETE FROM "caregiver_patient";
ALTER TABLE "caregiver_patient" DROP COLUMN "relationship";
ALTER TABLE "caregiver_patient"
  ADD COLUMN "relationship" "RelationshipType" NOT NULL;

-- ── B6: createdAt on join tables ─────────────────────────────────────────────
ALTER TABLE "post_likes"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "post_comment_likes"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "caregiver_patient"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── B1: composite indexes for actual query patterns ──────────────────────────

-- BloodPressureReading — "list my readings, newest first, paginated"
DROP INDEX IF EXISTS "blood_pressure_readings_user_id_idx";
DROP INDEX IF EXISTS "blood_pressure_readings_measured_at_idx";
CREATE INDEX "blood_pressure_readings_user_id_measured_at_idx"
  ON "blood_pressure_readings" ("user_id", "measured_at" DESC);

-- Post — "show my posts newest first" + "browse feed by category"
DROP INDEX IF EXISTS "posts_user_id_idx";
DROP INDEX IF EXISTS "posts_created_at_idx";
CREATE INDEX "posts_user_id_created_at_idx"
  ON "posts" ("user_id", "created_at" DESC);

-- Alert — "my unread alerts newest first" (read_at IS NULL ORDER BY created_at DESC)
DROP INDEX IF EXISTS "alerts_created_at_idx";
CREATE INDEX "alerts_user_id_read_at_created_at_idx"
  ON "alerts" ("user_id", "read_at", "created_at" DESC);

-- PostComment — "comments under this post, chronological"
DROP INDEX IF EXISTS "post_comments_post_id_idx";
CREATE INDEX "post_comments_post_id_created_at_idx"
  ON "post_comments" ("post_id", "created_at");
