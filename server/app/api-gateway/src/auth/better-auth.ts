import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  admin,
  bearer,
  emailOTP,
  haveIBeenPwned,
  phoneNumber,
} from 'better-auth/plugins';
import * as bcrypt from 'bcrypt';
import type Redis from 'ioredis';

import type { PrismaService } from '../prisma/prisma.service';
import {
  BCRYPT_SALT_ROUNDS,
  SESSION_TTL_MS,
  getJwtSecret,
} from './auth.config';

/**
 * The Better Auth instance.
 *
 * Every choice here is justified in docs/AUTH-better-auth-identity.md; this
 * file is where those decisions become configuration. The two that are easy
 * to undo by accident are marked inline.
 */

/** Five minutes of cookie-cached session before the store is consulted again. */
const SESSION_COOKIE_CACHE_SECONDS = 5 * 60;

/** Login attempts allowed per window, matching the guard this replaces. */
const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

/**
 * Inferred, not annotated: the generic instance type is what makes `auth.api.*`
 * typed for the GraphQL wrappers, and the bare `Auth` type discards the
 * additional user and session fields declared below.
 *
 * Keeping it inferred is why `zod` is a direct dependency — Better Auth's type
 * reaches into zod's internals, which TypeScript cannot name through a
 * transitive install. It is a types-only dependency with no runtime import.
 */
export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;

/**
 * Redis is optional at boot everywhere else in this service, so the wrapper
 * degrades the same way: a store that fails is treated as a cache miss rather
 * than an error. Sessions still resolve from Postgres, and rate limits fall
 * back to counting nothing — availability is preferred over throttling a user
 * we cannot count.
 */
function secondaryStorageFor(redis: Redis) {
  const ready = () => redis.status === 'ready';

  return {
    get: async (key: string) => {
      if (!ready()) return null;
      try {
        return await redis.get(key);
      } catch {
        return null;
      }
    },
    set: async (key: string, value: string, ttl?: number) => {
      if (!ready()) return;
      try {
        if (ttl) await redis.set(key, value, 'EX', ttl);
        else await redis.set(key, value);
      } catch {
        // Cache write failures must not fail the request.
      }
    },
    delete: async (key: string) => {
      if (!ready()) return;
      try {
        await redis.del(key);
      } catch {
        // As above.
      }
    },
  };
}

export function createBetterAuth(prisma: PrismaService, redis: Redis) {
  return betterAuth({
    appName: 'BP Monitor',
    // Reuses the existing secret so the deployment does not grow a second one
    // that could silently drift. getJwtSecret() already fails fast on a
    // missing or too-short value.
    secret: process.env.BETTER_AUTH_SECRET?.trim() || getJwtSecret(),
    basePath: '/api/auth',
    baseURL: process.env.BETTER_AUTH_URL,

    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    secondaryStorage: secondaryStorageFor(redis),

    emailAndPassword: {
      enabled: true,
      // Verification is offered, never required to use the app. It gates
      // linking a Google account and nothing else.
      requireEmailVerification: false,
      // Keeps every existing bcrypt hash valid. Dropping this silently
      // invalidates every password in the database.
      password: {
        hash: (password) => bcrypt.hash(password, BCRYPT_SALT_ROUNDS),
        verify: ({ hash, password }) => bcrypt.compare(password, hash),
      },
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await deliverEmail({
          to: user.email,
          subject: 'ตั้งรหัสผ่านใหม่',
          body: `Password reset link: ${url}`,
        });
      },
    },

    emailVerification: {
      sendOnSignUp: false,
      sendVerificationEmail: async ({ user, url }) => {
        await deliverEmail({
          to: user.email,
          subject: 'ยืนยันอีเมล',
          body: `Verification link: ${url}`,
        });
      },
    },

    user: {
      // The Prisma model is `User`; Better Auth's default model name already
      // resolves to it. Only the fields that live under a different name and
      // the domain columns need declaring.
      fields: { image: 'avatar' },
      additionalFields: {
        firstname: { type: 'string', required: true },
        lastname: { type: 'string', required: true },
        // input:false is load-bearing. Better Auth accepts additional fields
        // on sign-up, so without it a client can make itself a developer.
        // The database hook below is the second line of defence.
        role: { type: 'string', required: false, input: false },
        dob: { type: 'date', required: false },
        gender: { type: 'string', required: false },
        weight: { type: 'number', required: false },
        height: { type: 'number', required: false },
        congenitalDisease: { type: 'string', required: false },
        // Legacy column, retained until the credential backfill is confirmed.
        passwordHash: { type: 'string', required: false, input: false },
      },
    },

    session: {
      // Prisma model is `UserSession`, not `Session`.
      modelName: 'userSession',
      expiresIn: Math.floor(SESSION_TTL_MS / 1000),
      storeSessionInDatabase: true,
      // Sign-out flips isActive instead of deleting, so the login-sessions
      // screen keeps showing revoked devices as history. Removing this empties
      // that screen with no other symptom.
      preserveSessionInDatabase: true,
      cookieCache: {
        enabled: true,
        maxAge: SESSION_COOKIE_CACHE_SECONDS,
      },
      additionalFields: {
        deviceLabel: { type: 'string', required: false },
        isActive: { type: 'boolean', required: false, input: false },
        revokedAt: { type: 'date', required: false, input: false },
        lastActiveAt: { type: 'date', required: false, input: false },
      },
    },

    account: {
      accountLinking: {
        enabled: true,
        disableImplicitLinking: false,
        trustedProviders: ['google'],
        // Linking an account whose address differs from the local one throws
        // away the only ownership proof available.
        allowDifferentEmails: false,
      },
    },

    socialProviders: googleProvider(),

    rateLimit: {
      enabled: true,
      storage: 'secondary-storage',
      // Replaces login-throttle.guard.ts. Configured per path rather than per
      // resolver so a newly added credential route is covered by default —
      // the old guard only knew about the phone login mutation, which would
      // have left email sign-in as the cheaper way in.
      customRules: {
        '/sign-in/email': { window: LOGIN_WINDOW_SECONDS, max: LOGIN_ATTEMPTS },
        '/sign-in/phone-number': {
          window: LOGIN_WINDOW_SECONDS,
          max: LOGIN_ATTEMPTS,
        },
        '/sign-up/email': { window: LOGIN_WINDOW_SECONDS, max: LOGIN_ATTEMPTS },
        '/request-password-reset': { window: LOGIN_WINDOW_SECONDS, max: 3 },
        '/email-otp/send-verification-otp': {
          window: LOGIN_WINDOW_SECONDS,
          max: 3,
        },
      },
    },

    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            // Belt and braces with `input: false` above: whatever the request
            // carried, a new account is a patient.
            return Promise.resolve({ data: { ...user, role: 'patient' } });
          },
        },
      },
    },

    plugins: [
      // Converts `Authorization: Bearer` into the session cookie. Without it
      // the GraphQL guard cannot authenticate anything, because the mobile
      // client does not send cookies.
      bearer(),
      phoneNumber({
        // OTP is opt-in. Leaving this false is what keeps phone + password
        // sign-in working without sending (and paying for) an SMS.
        requireVerification: false,
        sendOTP: async ({ phoneNumber: to, code }) => {
          await deliverSms({ to, body: `BP Monitor code: ${code}` });
        },
      }),
      emailOTP({
        // Six digits typed into the app, rather than a link that leaves for
        // the system browser and has to deep-link back.
        sendVerificationOTP: async ({ email, otp }) => {
          await deliverEmail({
            to: email,
            subject: 'รหัสยืนยัน BP Monitor',
            body: `Verification code: ${otp}`,
          });
        },
      }),
      admin({
        defaultRole: 'patient',
        adminRoles: ['developer'],
      }),
      // Rejects passwords found in known breaches. No endpoints; a hook.
      haveIBeenPwned(),
    ],
  });
}

/**
 * Google is configured only when credentials are present.
 *
 * Better Auth would otherwise advertise a provider that fails at the redirect,
 * which reads to a user as "sign-in is broken" rather than "not set up here".
 */
function googleProvider() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) return {};

  return { google: { clientId, clientSecret } };
}

/**
 * Email delivery is not wired up yet — the gateway has no mail provider.
 *
 * This logs in development so the flows can be exercised, and throws in
 * production rather than silently dropping a password-reset link on the
 * floor. Replacing the body with a real send is the whole change.
 */
async function deliverEmail(message: {
  to: string;
  subject: string;
  body: string;
}): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'No email provider is configured. Email verification and password ' +
        'reset cannot be delivered. See docs/AUTH-better-auth-identity.md.',
    );
  }
  console.log('[auth:email]', message);
  return Promise.resolve();
}

/** Same stance as email: no SMS provider yet, and silence would be worse. */
async function deliverSms(message: {
  to: string;
  body: string;
}): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('No SMS provider is configured.');
  }
  console.log('[auth:sms]', message);
  return Promise.resolve();
}
