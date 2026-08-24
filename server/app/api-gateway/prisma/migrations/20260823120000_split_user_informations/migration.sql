-- Splits the patient health block off `users` into `user_informations`, and
-- makes `users.phone` nullable.
--
-- Why: `users` is Better Auth's table. Any field declared to Better Auth as a
-- required `additionalField` must be supplied on every create path, including
-- the OAuth one, or `parseInputData` throws MISSING_FIELD before a single
-- statement is issued. Moving the health block off the table takes it out of
-- Better Auth's field set entirely. Separately, a Google ID token carries no
-- phone number, so the NOT NULL on `users.phone` blocked social sign-up at the
-- database once the field checks were satisfied.
--
-- Backfill policy: this project is in development and its data is resettable,
-- which is the only reason this migration is written the way it is. A
-- `user_informations` row is created only for users who already have all four
-- required values (dob, gender, weight, height). `congenital_disease` carries
-- across as-is, NULL included, because NULL is a meaningful answer there
-- ("no condition") and not a gap. Users missing any of the four get no row and
-- are re-prompted by the health step. On a database with real data this
-- migration is WRONG as written and must be replaced by an expand -> backfill
-- -> contract sequence with agreed values for the gaps.

-- AlterTable: `phone` becomes nullable. The UNIQUE index is kept and is now
-- doing extra work: Postgres allows many NULLs under it, so an account with
-- no phone can never be matched by an equality lookup on `phone`.
ALTER TABLE "users" ALTER COLUMN "phone" DROP NOT NULL;

-- CreateTable
--
-- `congenital_disease` is the one nullable column, and its NULL is an answer
-- ("no condition"), not a gap -- the three states are: no row (step not
-- completed), row with NULL (answered: none), row with text (answered: that
-- condition). Do not backfill it to the string 'ไม่มี'; that is a sentinel a
-- user can type themselves, and the two would be indistinguishable forever.
CREATE TABLE "user_informations" (
    "user_id" UUID NOT NULL,
    "dob" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "congenital_disease" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_informations_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "user_informations" ADD CONSTRAINT "user_informations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: gated on the four required values only. A user missing any of them
-- gets no row at all, which reads downstream as "health step not completed" --
-- the same state a fresh Google sign-in is in, and the state the health step
-- exists to resolve. Deliberately not inventing a weight nobody entered.
INSERT INTO "user_informations" ("user_id", "dob", "gender", "weight", "height", "congenital_disease", "created_at", "updated_at")
SELECT "id", "dob", "gender", "weight", "height", "congenital_disease", "created_at", "updated_at"
FROM "users"
WHERE "dob" IS NOT NULL
  AND "gender" IS NOT NULL
  AND "weight" IS NOT NULL
  AND "height" IS NOT NULL;

-- DropColumn: irreversible. Anything not carried by the INSERT above is gone,
-- including a `congenital_disease` belonging to a user who was missing one of
-- the four required values.
ALTER TABLE "users" DROP COLUMN "dob";
ALTER TABLE "users" DROP COLUMN "gender";
ALTER TABLE "users" DROP COLUMN "weight";
ALTER TABLE "users" DROP COLUMN "height";
ALTER TABLE "users" DROP COLUMN "congenital_disease";
