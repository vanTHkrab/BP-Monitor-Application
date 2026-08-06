-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_login_method" VARCHAR(32);

-- CreateTable
CREATE TABLE "passkeys" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255),
    "public_key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_id" VARCHAR(255) NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "device_type" VARCHAR(32) NOT NULL,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "transports" VARCHAR(255),
    "aaguid" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credential_id_key" ON "passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "passkeys_user_id_idx" ON "passkeys"("user_id");

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
