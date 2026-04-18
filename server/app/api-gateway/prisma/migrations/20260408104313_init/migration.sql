-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('caregiver', 'developer', 'patient');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "ImageSyncStatus" AS ENUM ('pending', 'synced', 'failed');

-- CreateEnum
CREATE TYPE "BpLevel" AS ENUM ('normal', 'elevated', 'high risk');

-- CreateEnum
CREATE TYPE "AlertLevel" AS ENUM ('warning', 'critical');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "firstname" VARCHAR(100) NOT NULL,
    "lastname" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(30) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'patient',
    "dob" DATE,
    "gender" "Gender",
    "weight" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "congenital_disease" VARCHAR(255),
    "avatar" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "caregiver_patient" (
    "caregiver_id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "relationship" VARCHAR(100) NOT NULL,

    CONSTRAINT "caregiver_patient_pkey" PRIMARY KEY ("caregiver_id","patient_id")
);

-- CreateTable
CREATE TABLE "images" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "image_url" VARCHAR(2048) NOT NULL,
    "device_name" VARCHAR(255) NOT NULL,
    "image_quality_score" DOUBLE PRECISION,
    "sync_status" "ImageSyncStatus" NOT NULL DEFAULT 'pending',
    "synced_at" TIMESTAMP(3),
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_results" (
    "id" SERIAL NOT NULL,
    "image_id" INTEGER NOT NULL,
    "systolic" INTEGER NOT NULL,
    "diastolic" INTEGER NOT NULL,
    "pulse_rate" INTEGER NOT NULL,
    "confidence_score" DOUBLE PRECISION NOT NULL,
    "bp_level" "BpLevel" NOT NULL,
    "analysis_note" VARCHAR(500),
    "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "analysis_id" INTEGER NOT NULL,
    "alert_message" VARCHAR(500) NOT NULL,
    "alert_level" "AlertLevel" NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "caregiver_patient_patient_id_idx" ON "caregiver_patient"("patient_id");

-- CreateIndex
CREATE INDEX "images_user_id_idx" ON "images"("user_id");

-- CreateIndex
CREATE INDEX "images_sync_status_idx" ON "images"("sync_status");

-- CreateIndex
CREATE UNIQUE INDEX "analysis_results_image_id_key" ON "analysis_results"("image_id");

-- CreateIndex
CREATE INDEX "analysis_results_bp_level_idx" ON "analysis_results"("bp_level");

-- CreateIndex
CREATE INDEX "analysis_results_analyzed_at_idx" ON "analysis_results"("analyzed_at");

-- CreateIndex
CREATE INDEX "alerts_analysis_id_idx" ON "alerts"("analysis_id");

-- CreateIndex
CREATE INDEX "alerts_user_id_is_read_idx" ON "alerts"("user_id", "is_read");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- AddForeignKey
ALTER TABLE "caregiver_patient" ADD CONSTRAINT "caregiver_patient_caregiver_id_fkey" FOREIGN KEY ("caregiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "caregiver_patient" ADD CONSTRAINT "caregiver_patient_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "analysis_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;
