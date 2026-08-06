-- CreateTable
CREATE TABLE "profile_change_logs" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_name" VARCHAR(201) NOT NULL,
    "field" VARCHAR(64) NOT NULL,
    "old_value" VARCHAR(512),
    "new_value" VARCHAR(512),
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_change_logs_patient_id_changed_at_idx" ON "profile_change_logs"("patient_id", "changed_at" DESC);

-- AddForeignKey
ALTER TABLE "profile_change_logs" ADD CONSTRAINT "profile_change_logs_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_change_logs" ADD CONSTRAINT "profile_change_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
