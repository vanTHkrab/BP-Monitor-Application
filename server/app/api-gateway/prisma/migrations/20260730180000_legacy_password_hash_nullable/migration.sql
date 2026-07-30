-- Better Auth writes credentials to accounts.password, never to
-- users.password_hash. The column is legacy and slated for removal, but until
-- then it must tolerate rows that never had a value: otherwise every sign-up
-- fails on a NOT NULL that only pre-migration users could satisfy.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
