-- CreateEnum
CREATE TYPE "BpStatus" AS ENUM ('low', 'normal', 'elevated', 'high', 'critical');

-- CreateEnum
CREATE TYPE "PostCategory" AS ENUM ('general', 'experience', 'qa');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "blood_pressure_readings" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" VARCHAR(255),
    "systolic" INTEGER NOT NULL,
    "diastolic" INTEGER NOT NULL,
    "pulse" INTEGER NOT NULL,
    "status" "BpStatus" NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "image_uri" VARCHAR(2048),
    "notes" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blood_pressure_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" VARCHAR(255),
    "content" TEXT NOT NULL,
    "category" "PostCategory" NOT NULL DEFAULT 'general',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "post_likes" (
    "user_id" UUID NOT NULL,
    "post_id" INTEGER NOT NULL,

    CONSTRAINT "post_likes_pkey" PRIMARY KEY ("user_id","post_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blood_pressure_readings_client_id_key" ON "blood_pressure_readings"("client_id");

-- CreateIndex
CREATE INDEX "blood_pressure_readings_user_id_idx" ON "blood_pressure_readings"("user_id");

-- CreateIndex
CREATE INDEX "blood_pressure_readings_measured_at_idx" ON "blood_pressure_readings"("measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "posts_client_id_key" ON "posts"("client_id");

-- CreateIndex
CREATE INDEX "posts_user_id_idx" ON "posts"("user_id");

-- CreateIndex
CREATE INDEX "posts_category_idx" ON "posts"("category");

-- CreateIndex
CREATE INDEX "posts_created_at_idx" ON "posts"("created_at");

-- AddForeignKey
ALTER TABLE "blood_pressure_readings" ADD CONSTRAINT "blood_pressure_readings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
