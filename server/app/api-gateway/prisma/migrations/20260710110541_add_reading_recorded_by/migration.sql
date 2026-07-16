-- Additive only: nullable attribution column on blood_pressure_readings.
-- NULL = recorded by the patient themselves (covers all existing rows, no backfill).
-- ON DELETE SET NULL: deleting the recorder's account (e.g. a caregiver) must not
-- delete or block the patient's reading; attribution degrades to the patient default.

-- AlterTable
ALTER TABLE "blood_pressure_readings" ADD COLUMN     "recorded_by_id" UUID;

-- AddForeignKey
ALTER TABLE "blood_pressure_readings" ADD CONSTRAINT "blood_pressure_readings_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
