-- PR A — Drop AnalysisResult + BpLevel, repoint Alert -> BloodPressureReading, rename users.password
--
-- Pre-launch assumption: `analysis_results` and `alerts` are empty in every
-- environment (no resolver ever wrote to them). If you run this against a
-- database where alerts has rows, the FK switch below will fail — that's
-- intentional, do not work around it without a backfill plan.

-- 1. Drop the legacy alerts -> analysis_results FK path.
ALTER TABLE "alerts" DROP CONSTRAINT IF EXISTS "alerts_analysis_id_fkey";
DROP INDEX IF EXISTS "alerts_analysis_id_idx";
ALTER TABLE "alerts" DROP COLUMN IF EXISTS "analysis_id";

-- 2. Add the new alerts -> blood_pressure_readings FK.
ALTER TABLE "alerts" ADD COLUMN "bp_reading_id" INTEGER NOT NULL;
ALTER TABLE "alerts"
  ADD CONSTRAINT "alerts_bp_reading_id_fkey"
  FOREIGN KEY ("bp_reading_id")
  REFERENCES "blood_pressure_readings"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
CREATE INDEX "alerts_bp_reading_id_idx" ON "alerts"("bp_reading_id");

-- 3. Drop the unused AnalysisResult table + enum.
DROP TABLE IF EXISTS "analysis_results";
DROP TYPE IF EXISTS "BpLevel";

-- 4. Rename users.password → users.password_hash. The column has always held
--    a bcrypt hash; the original name was misleading and tripped audit tools.
ALTER TABLE "users" RENAME COLUMN "password" TO "password_hash";
