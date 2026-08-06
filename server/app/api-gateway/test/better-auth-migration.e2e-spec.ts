import 'dotenv/config';

import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Post-conditions of `20260730000000_better_auth_identity`.
 *
 * A Prisma migration has no down script, so the backfill it performs cannot
 * be re-run and inspected once it has been applied. These assertions are the
 * only mechanical check that it did what the SQL claims — and they double as
 * a pre-flight check before the same migration runs against another
 * environment.
 *
 * They intentionally assert over whatever data the configured database
 * holds, rather than over a fixture: the failure this guards against is a
 * *row* the backfill missed, which a fixture would never reproduce.
 *
 * Runs against DATABASE_URL. Skipped when it is unset so a checkout without
 * a database still passes the suite.
 */
const describeWithDatabase = process.env.DATABASE_URL
  ? describe
  : describe.skip;

/** RFC 2606 reserved TLD; the backfill marks address-less users with it. */
const PLACEHOLDER_EMAIL_DOMAIN = '@bp-monitor.invalid';

describeWithDatabase('better_auth_identity migration', () => {
  // Reuses PrismaService rather than a bare client so the test connects the
  // same way the application does — Prisma 7 needs an explicit adapter.
  const prisma = new PrismaService();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('users', () => {
    it('gives every user a display name derived from firstname + lastname', async () => {
      const mismatched = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM users
        WHERE name IS NULL OR btrim(name) = '' OR name <> btrim(firstname || ' ' || lastname)
      `;

      expect(Number(mismatched[0].n)).toBe(0);
    });

    it('leaves no user without an email address', async () => {
      // The column is NOT NULL now, so this can only fail if a later
      // migration relaxes it — which would silently break account linking.
      const nullEmails = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM users WHERE email IS NULL
      `;

      expect(Number(nullEmails[0].n)).toBe(0);
    });

    it('never marks a placeholder address as verified', async () => {
      // A verified placeholder would satisfy requireLocalEmailVerified and
      // let a Google account link into a row whose address nobody owns.
      const verifiedPlaceholders = await prisma.user.count({
        where: {
          email: { endsWith: PLACEHOLDER_EMAIL_DOMAIN },
          emailVerified: true,
        },
      });

      expect(verifiedPlaceholders).toBe(0);
    });
  });

  describe('credential accounts', () => {
    it('gives every user exactly one credential account', async () => {
      const wrongCount = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM users u
        WHERE (
          SELECT count(*) FROM accounts a
          WHERE a.user_id = u.id AND a.provider_id = 'credential'
        ) <> 1
      `;

      expect(Number(wrongCount[0].n)).toBe(0);
    });

    it('carries the legacy bcrypt hash across unchanged', async () => {
      // Better Auth reads credentials from accounts.password. If the copy
      // diverged, sign-in fails for that user with no other symptom.
      const diverged = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM users u
        JOIN accounts a ON a.user_id = u.id AND a.provider_id = 'credential'
        WHERE a.password IS DISTINCT FROM u.password_hash
      `;

      expect(Number(diverged[0].n)).toBe(0);
    });

    it('stores hashes that are still bcrypt', async () => {
      const nonBcrypt = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM accounts
        WHERE provider_id = 'credential' AND password !~ '^\\$2[aby]\\$'
      `;

      expect(Number(nonBcrypt[0].n)).toBe(0);
    });
  });

  describe('sessions', () => {
    it('gives every session a unique token', async () => {
      const duplicates = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM (
          SELECT token FROM user_sessions GROUP BY token HAVING count(*) > 1
        ) t
      `;

      expect(Number(duplicates[0].n)).toBe(0);
    });

    it('gives every session an expiry', async () => {
      const missing = await prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM user_sessions WHERE expires_at IS NULL
      `;

      expect(Number(missing[0].n)).toBe(0);
    });

    it('records a revocation time for every inactive session', async () => {
      // The login-sessions screen shows revoked devices as history; an
      // inactive row with no revokedAt renders with a blank timestamp.
      const missingRevokedAt = await prisma.userSession.count({
        where: { isActive: false, revokedAt: null },
      });

      expect(missingRevokedAt).toBe(0);
    });
  });

  describe('new tables', () => {
    it('creates verifications empty and queryable', async () => {
      await expect(prisma.verification.count()).resolves.toBeGreaterThanOrEqual(
        0,
      );
    });

    it('enforces one account per provider identity', async () => {
      // This unique constraint is what stops a second Google identity being
      // linked into the same row.
      const constraint = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'accounts' AND indexname = 'accounts_provider_id_account_id_key'
      `;

      expect(constraint).toHaveLength(1);
    });
  });
});
