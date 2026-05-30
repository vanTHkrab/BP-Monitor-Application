-- CreateEnum
CREATE TYPE "CaregiverLinkStatus" AS ENUM ('pending', 'accepted', 'rejected');

-- AlterTable
ALTER TABLE "caregiver_patient" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "responded_at" TIMESTAMP(3),
ADD COLUMN     "status" "CaregiverLinkStatus" NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "caregiver_patient_status_idx" ON "caregiver_patient"("status");
