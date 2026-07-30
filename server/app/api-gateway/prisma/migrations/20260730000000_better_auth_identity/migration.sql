-- Better Auth identity migration.
--
-- Prepares the schema for Better Auth 1.6 without moving any of the ten
-- relations that point at users.id. See docs/AUTH-better-auth-identity.md.
--
-- Every NOT NULL column here is added nullable, backfilled, and only then
-- constrained. The generated diff added them NOT NULL directly, which fails
-- against any existing row.

-- ─────────────────────────── users ───────────────────────────

ALTER TABLE "users"
  ADD COLUMN "email_verified"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "phone_number_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "banned"                BOOLEAN DEFAULT false,
  ADD COLUMN "ban_reason"            VARCHAR(255),
  ADD COLUMN "ban_expires"           TIMESTAMP(3),
  ADD COLUMN "name"                  VARCHAR(201);

-- Better Auth requires a single display name and a field maps to exactly one
-- column, so `name` is derived rather than overloading `firstname`.
UPDATE "users"
SET "name" = btrim("firstname" || ' ' || "lastname")
WHERE "name" IS NULL;

ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;

-- Email becomes the ownership proof that account linking depends on, so it
-- can no longer be null. Rows predating that rule get a placeholder under
-- .invalid, a TLD reserved by RFC 2606 that can never resolve or be
-- registered. That is what makes these distinguishable from real addresses
-- forever — the objection to Better Auth's getTempEmail() escape hatch was
-- that synthetic addresses become indistinguishable, not that they exist.
--
-- These accounts are unverified by construction (email_verified defaults to
-- false), so they cannot link a Google account until the address is replaced.
UPDATE "users"
SET "email" = 'needs-email+' || "id"::text || '@bp-monitor.invalid'
WHERE "email" IS NULL;

ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;

-- ─────────────────────── user_sessions ───────────────────────

ALTER TABLE "user_sessions"
  ADD COLUMN "token"           VARCHAR(255),
  ADD COLUMN "expires_at"      TIMESTAMP(3),
  ADD COLUMN "ip_address"      VARCHAR(45),
  ADD COLUMN "impersonated_by" UUID,
  ADD COLUMN "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The session id is already unique, so it satisfies the new unique token
-- column. These tokens are not valid Better Auth sessions and are never
-- matched — see the revocation below.
UPDATE "user_sessions" SET "token" = "id"::text WHERE "token" IS NULL;

-- Mirrors the JWT_EXPIRES_IN default the old sessions were issued under.
UPDATE "user_sessions"
SET "expires_at" = "created_at" + INTERVAL '7 days'
WHERE "expires_at" IS NULL;

ALTER TABLE "user_sessions" ALTER COLUMN "token" SET NOT NULL;
ALTER TABLE "user_sessions" ALTER COLUMN "expires_at" SET NOT NULL;

-- Every pre-migration session is dead: clients hold a JWT that the new guard
-- will not accept, and no request can produce a matching Better Auth token.
-- Recording that explicitly beats leaving rows that read as active but can
-- never authenticate. Users re-authenticate once; the rows stay for the
-- login-sessions history screen.
UPDATE "user_sessions"
SET "is_active" = false,
    "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP)
WHERE "is_active" = true;

-- ────────────────────────── accounts ─────────────────────────

CREATE TABLE "accounts" (
    "id"                       UUID         NOT NULL,
    "account_id"               VARCHAR(255) NOT NULL,
    "provider_id"              VARCHAR(64)  NOT NULL,
    "user_id"                  UUID         NOT NULL,
    "access_token"             TEXT,
    "refresh_token"            TEXT,
    "id_token"                 TEXT,
    "access_token_expires_at"  TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "scope"                    VARCHAR(512),
    "password"                 VARCHAR(255),
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");
CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Better Auth reads credentials from accounts.password, not users.password_hash.
-- Copying rather than moving: users.password_hash is dropped in a follow-up,
-- once the new sign-in path is confirmed against real logins. The hashes stay
-- bcrypt — password.verify is overridden, so nobody is forced to reset.
INSERT INTO "accounts" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at")
SELECT gen_random_uuid(), u."id"::text, 'credential', u."id", u."password_hash", u."created_at", u."updated_at"
FROM "users" u;

-- ──────────────────────── verifications ──────────────────────

CREATE TABLE "verifications" (
    "id"         UUID         NOT NULL,
    "identifier" VARCHAR(255) NOT NULL,
    "value"      VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");
CREATE INDEX "verifications_expires_at_idx" ON "verifications"("expires_at");

-- ────────────────────────── indexes ──────────────────────────

CREATE UNIQUE INDEX "user_sessions_token_key" ON "user_sessions"("token");
