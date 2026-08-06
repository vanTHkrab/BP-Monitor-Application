-- CreateEnum
CREATE TYPE "CaregiverPermission" AS ENUM ('view', 'full');

-- AlterTable
ALTER TABLE "caregiver_patient" ADD COLUMN     "permission" "CaregiverPermission" NOT NULL DEFAULT 'full';

