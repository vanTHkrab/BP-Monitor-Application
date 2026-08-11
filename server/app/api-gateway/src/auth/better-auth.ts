import { randomUUID } from 'node:crypto';

import { passkey } from '@better-auth/passkey';
import { Logger } from '@nestjs/common';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  admin,
  bearer,
  emailOTP,
  haveIBeenPwned,
  lastLoginMethod,
  phoneNumber,
} from 'better-auth/plugins';
import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements } from 'better-auth/plugins/admin/access';
import * as bcrypt from 'bcrypt';
import type Redis from 'ioredis';

import type { MailSender } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RateLimitService } from '../redis/rate-limit.service';
import { betterAuthSecondaryStorage } from '../redis/secondary-storage';
import { isProduction } from '../env';
import {
  otpEmail,
  resetPasswordEmail,
  verifyEmailEmail,
} from '../mail/mail.templates';
import { androidOriginsFromFingerprints } from './android-origin';
import {
  BCRYPT_SALT_ROUNDS,
  SESSION_TTL_MS,
  getJwtSecret,
} from './auth.config';
import { normalizeSelfAssignedRole } from './types/auth.types';

/**
 * The Better Auth instance.
 *
 * Every choice here is justified in docs/architecture/AUTH-better-auth-identity.md; this
 * file is where those decisions become configuration. The two that are easy
 * to undo by accident are marked inline.
 */

const logger = new Logger('BetterAuth');

/** Where BetterAuthController is mounted. Both sides must agree. */
export const AUTH_BASE_PATH = '/api/auth';

/**
 * Better Auth's `baseURL` must be this gateway's origin plus the base path.
 *
 * Getting it wrong costs nothing at boot and everything afterwards: the app
 * starts, the route maps, and every request under /api/auth returns 404 with
 * nothing logged. Neither the type-checker nor a unit test can see it — this
 * has already happened once, against a BETTER_AUTH_URL that pointed at
 * /graphql.
 *
 * So only the *origin* of the configured value is used and the base path is
 * appended here. Anything else in the URL is discarded rather than
 * concatenated into a path that cannot route, and the discard is logged so it
 * is visible rather than mysterious.
 */
function resolveAuthBaseURL(): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();

  if (configured) {
    let origin: string;
    try {
      origin = new URL(configured).origin;
    } catch {
      throw new Error(
        `BETTER_AUTH_URL is not a valid URL: "${configured}". Set it to the ` +
          `origin of this gateway, e.g. https://api.example.com — ` +
          `${AUTH_BASE_PATH} is appended automatically.`,
      );
    }

    const discarded = configured.replace(/\/+$/, '').slice(origin.length);
    if (discarded && discarded !== AUTH_BASE_PATH) {
      logger.warn(
        `BETTER_AUTH_URL contains a path ("${discarded}") that is not ` +
          `${AUTH_BASE_PATH}; ignoring it. Set the origin only.`,
      );
    }

    return `${origin}${AUTH_BASE_PATH}`;
  }

  if (isProduction()) {
    throw new Error(
      'BETTER_AUTH_URL is not set. Refusing to boot — OAuth redirects and ' +
        'verification links would point at localhost. Set it to the public ' +
        `origin of this gateway (${AUTH_BASE_PATH} is appended automatically).`,
    );
  }

  // Development only. A wrong origin breaks OAuth redirects, which is why
  // production refuses to guess one.
  const port = process.env.PORT ?? '3000';
  return `http://localhost:${port}${AUTH_BASE_PATH}`;
}

/** Login attempts allowed per window, matching the guard this replaces. */
const LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

/**
 * Access control for this app's roles.
 *
 * The admin plugin defines only `admin` and `user`. `UserRole` in the Prisma
 * schema is `patient | caregiver | developer`, so every role has to be
 * declared here — naming one in `adminRoles` that is absent throws at boot.
 *
 * The statements are the admin plugin's own (user/session management). They
 * describe who may administer *accounts*, which is a separate question from
 * who may read a given patient's readings — that stays with the
 * `CaregiverPatient` links, because it is per-relationship rather than
 * per-role.
 */
const accessControl = createAccessControl(defaultStatements);

const APP_ROLES = {
  /** Owns their own data and nothing else. No account administration. */
  patient: accessControl.newRole({}),
  /**
   * Also no account administration. A caregiver's extra reach comes from an
   * accepted CaregiverPatient link, not from this role — granting it here
   * would let any caregiver act on any patient.
   */
  caregiver: accessControl.newRole({}),
  /** Full account administration. Mirrors the plugin's built-in admin role. */
  developer: accessControl.newRole({
    user: [...defaultStatements.user],
    session: [...defaultStatements.session],
  }),
};

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
 * `mail` is passed in rather than imported.
 *
 * This function runs outside Nest's DI graph — `better-auth.provider.ts` calls
 * it from a `useFactory` — so the only way a Nest-managed singleton reaches the
 * plugin callbacks below is as an argument. Importing `MailService` here and
 * constructing one would work at runtime and be wrong twice over: a second
 * instance means a second nodemailer pool that `onModuleDestroy` never closes,
 * and the send path would be reachable only through this file, which the CJS
 * Jest setup cannot parse. Taking the `MailSender` interface keeps the
 * dependency inverted and leaves the implementation testable on its own.
 */
export function createBetterAuth(
  prisma: PrismaService,
  redis: Redis,
  rateLimit: RateLimitService,
  mail: MailSender,
) {
  return betterAuth({
    appName: 'BP Monitor',
    // Reuses the existing secret so the deployment does not grow a second one
    // that could silently drift. getJwtSecret() already fails fast on a
    // missing or too-short value.
    secret: process.env.BETTER_AUTH_SECRET?.trim() || getJwtSecret(),
    // `basePath` is deliberately NOT set: Better Auth derives it from
    // `baseURL`, and supplying both makes it look for /api/auth/api/auth —
    // which 404s every route while the app still boots cleanly.
    baseURL: resolveAuthBaseURL(),

    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    advanced: {
      database: {
        // Better Auth defaults to a 32-character nanoid. Every id column here
        // is @db.Uuid — including the one ten relations point at — so Postgres
        // rejects the insert outright. Changing the columns to text instead
        // would mean rewriting those relations.
        generateId: () => randomUUID(),
      },
      ipAddress: {
        /**
         * Every rate limit in this service is keyed by `<ip>|<path>`, and
         * when the IP cannot be resolved Better Auth substitutes a literal
         * `no-trusted-ip` — one shared bucket for every caller. That is not a
         * degraded limit, it is a denial of service: the login rule of 5 per
         * 15 minutes becomes five attempts for the entire user base, so one
         * person fat-fingering a password locks everyone out.
         *
         * The default header is `x-forwarded-for`, and it does **not** work
         * here. `getIPFromHeader` refuses any XFF carrying more than one
         * entry unless `trustedProxies` is configured, and by the time a
         * request reaches this service the header holds two: Cloudflare sets
         * one at the edge and nginx appends `$remote_addr` via
         * `$proxy_add_x_forwarded_for`. The result is `null` — silently, in
         * production, where the warning is not being read.
         *
         * `x-real-ip` is a single value, and nginx sets it from
         * `$remote_addr`, which `real_ip_header CF-Connecting-IP` has already
         * rewritten to the true client address
         * (`infra/nginx/templates/default.conf.template`).
         *
         * The trust this buys is only as good as the network: anything that
         * can reach this service directly can claim any address. In the
         * deployed stack nothing can — the api-gateway publishes no host port
         * and only nginx sits on `bp-net` in front of it. Publishing a port,
         * or putting a second client on that network, breaks this assumption
         * without breaking anything visible.
         *
         * In development there is no proxy and therefore no header. Better
         * Auth falls back to 127.0.0.1, but only when `NODE_ENV` is exactly
         * `development` or `dev` — unlike this project's own `isProduction()`,
         * which treats unset as development. An unset `NODE_ENV` locally is
         * what produces the shared-bucket warning at startup.
         */
        ipAddressHeaders: ['x-real-ip'],
      },
    },
    secondaryStorage: betterAuthSecondaryStorage(redis),

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
        await mail.send({ to: user.email, ...resetPasswordEmail(url) });
      },
    },

    emailVerification: {
      sendOnSignUp: false,
      sendVerificationEmail: async ({ user, url }) => {
        await mail.send({ to: user.email, ...verifyEmailEmail(url) });
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
        // `input: false` is not optional here, and not merely defensive: the
        // `admin` plugin declares `role` with `input: false` in its own
        // schema, and a plugin's field declaration wins over this one. A
        // sign-up carrying `role` is rejected outright with "role is not
        // allowed to be set", so passing one through `signUpEmail` breaks
        // registration entirely. (The plugin's `schema` option cannot undo
        // it — `InferOptionSchema` only renames columns.)
        //
        // Self-selected roles are therefore applied *after* creation, by
        // AuthService.register. See `normalizeSelfAssignedRole`.
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
      // Cookie caching is deliberately OFF.
      //
      // Revocation here is out-of-band: sign-out flips `isActive`, a column
      // Better Auth does not know about, so a cached session stays valid until
      // the cache expires. That turns logout into "logged out in about five
      // minutes", which is not what a user pressing it expects — and is worse
      // on a shared or stolen device.
      //
      // The cost is a session lookup per request, which is what the previous
      // JWT guard already did. Re-enabling this needs revocation to go through
      // Better Auth's own API so it can invalidate the cache.
      cookieCache: { enabled: false },
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
      // `customStorage` rather than 'secondary-storage': the latter only gets
      // get/set, and Better Auth warns that a limiter built on those is
      // best-effort — two concurrent requests both read the old count and both
      // pass. A credential endpoint is exactly where that matters.
      //
      // The primitive itself now lives in `redis/rate-limit.service.ts`; this
      // is only the adapter to Better Auth's contract. Any other caller that
      // needs a budget injects the same service and therefore gets the same
      // atomicity and the same Redis-down policy.
      customStorage: rateLimit.betterAuthStorage(),
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
        // Requesting a password-reset code is unauthenticated and spends the
        // mail quota exactly like the verification code above, so it gets the
        // same budget.
        //
        // Both paths are listed because they are two routes onto one handler:
        // `/forget-password/email-otp` is what the mobile client calls today
        // (client/src/modules/auth/services/email-otp-api.ts) and Better Auth
        // marks it deprecated in favour of the canonical one. Rules are keyed
        // by path, so limiting only the deprecated alias leaves the
        // replacement uncapped, and limiting only the canonical one caps
        // nothing the client actually hits. The cost of listing both is that
        // the two counters are independent — a caller willing to alternate
        // paths gets 6 sends per window rather than 3. That is still bounded,
        // and it collapses back to 3 when the deprecated route is removed.
        '/forget-password/email-otp': { window: LOGIN_WINDOW_SECONDS, max: 3 },
        '/email-otp/request-password-reset': {
          window: LOGIN_WINDOW_SECONDS,
          max: 3,
        },
      },
    },

    databaseHooks: {
      user: {
        create: {
          before: (user) => {
            // Last line of defence on the way into the table. `input: false`
            // above already means a sign-up cannot carry a role, so in
            // practice this sets the default for every path — GraphQL
            // `register`, a direct `/api/auth/sign-up/*` call, and the Google
            // OAuth callback.
            //
            // It stays because it fails closed: if a future change makes
            // `role` writable at sign-up again, anything unrecognised or
            // privileged still lands on `patient` rather than being written
            // verbatim.
            const role = normalizeSelfAssignedRole(
              (user as { role?: unknown }).role,
            );
            return Promise.resolve({ data: { ...user, role } });
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
        // The plugin's own fields need mapping here, not in `user.fields`:
        // it owns them, so the top-level map never sees them. Without this
        // the adapter writes a `phoneNumber` column that does not exist and
        // every sign-up fails on the missing `phone`.
        schema: {
          user: {
            fields: {
              phoneNumber: 'phone',
              phoneNumberVerified: 'phoneNumberVerified',
            },
          },
        },
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
        //
        // `type` is load-bearing: the same callback serves sign-in,
        // verification, and password reset, so ignoring it titles a reset code
        // "รหัสยืนยัน BP Monitor" — which reads to the user as mail they did
        // not ask for, in the one flow where that matters most.
        sendVerificationOTP: async ({ email, otp, type }) => {
          await mail.send({ to: email, ...otpEmail(type, otp) });
        },
      }),
      admin({
        defaultRole: 'patient',
        adminRoles: ['developer'],
        // `adminRoles` is validated against these keys at construction, so a
        // role named here that is missing below fails at boot rather than at
        // the first permission check. That validation is the whole reason this
        // map has to exist: the plugin ships only `admin` and `user`, and none
        // of this app's three roles is either of those.
        roles: APP_ROLES,
      }),
      // Rejects passwords found in known breaches. No endpoints; a hook.
      haveIBeenPwned({
        enabled: process.env.HAVE_I_BEEN_PWNED_ENABLED === 'true',
      }),
      // `storeInDatabase` is what makes this usable from the mobile app. The
      // plugin's default is a cookie, and the mobile client authenticates
      // with a bearer token and never sends or stores cookies — the column is
      // the only copy it can read (exposed as `User.lastLoginMethod`).
      //
      // It is a convenience signal, not a security control: it tells the
      // sign-in screen which method to offer first. Nothing authorises on it.
      lastLoginMethod({ storeInDatabase: true }),
      ...passkeyPlugin(),
    ],
  });
}

/**
 * Passkeys are configured only when an RP ID is present.
 *
 * The relying-party ID is a bare registered domain — never an IP, never a
 * port, never a scheme. That rules out the LAN address the gateway runs on in
 * development, so the plugin genuinely cannot be loaded there: registration
 * would fail at the authenticator before any request reached this service.
 * Leaving it out entirely is the honest state, and it is what lets the mobile
 * client hide the passkey section rather than offer a button that cannot work.
 */
function passkeyPlugin() {
  const rpID = process.env.PASSKEY_RP_ID?.trim();
  if (!rpID) return [];

  if (/[:/]/.test(rpID)) {
    throw new Error(
      `PASSKEY_RP_ID must be a bare domain (e.g. "bp.example.com"), got ` +
        `"${rpID}". A scheme, port, or path here fails at the authenticator ` +
        'with a mismatched-RP error that looks like a server bug.',
    );
  }

  const androidOrigins = androidOriginsFromFingerprints(
    process.env.ANDROID_APP_SHA256_FINGERPRINT,
  );

  if (androidOrigins.length === 0) {
    // Not fatal: the web dashboard can still register passkeys against the
    // https origin. But the mobile app — the reason this exists — cannot,
    // so silence would be the wrong choice.
    logger.warn(
      'PASSKEY_RP_ID is set but ANDROID_APP_SHA256_FINGERPRINT is missing or ' +
        "malformed (expected keytool's 32 colon-separated hex bytes, " +
        'comma-separated for several builds). Passkey registration from the ' +
        'Android app will be rejected as a mismatched origin.',
    );
  }

  const origins = [`https://${rpID}`, ...androidOrigins];

  return [
    passkey({
      rpID,
      rpName: process.env.PASSKEY_RP_NAME?.trim() || 'BP Monitor',
      origin: origins,
      authenticatorSelection: {
        // The phone's own screen lock, not a roaming security key: this is a
        // patient-facing health app, and requiring separate hardware would
        // exclude almost everyone it is meant to serve.
        authenticatorAttachment: 'platform',
        // Passkeys must be discoverable or they cannot be used to *start* a
        // sign-in — the account picker has nothing to list, and the feature
        // degrades to a second factor, which is not what was asked for.
        residentKey: 'required',
        requireResidentKey: true,
        // The screen lock has already been satisfied to unlock the key.
        // 'required' on top of that prompts twice on some Android builds.
        userVerification: 'preferred',
      },
    }),
  ];
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

  // The Android client ID is a second *audience*, not a second provider.
  //
  // Google issues an ID token whose `aud` is the client ID that asked for it,
  // and the Android app asks through its own. Verification compares `aud`
  // against this list, so omitting the Android ID makes every One Tap sign-in
  // fail as an invalid token while the web flow keeps working — a failure
  // that looks like a broken mobile build rather than a missing env var.
  //
  // Order matters: the first entry is the one used as `client_id` in the
  // browser redirect flow, so the web credential stays first.
  const androidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID?.trim();
  const audiences = androidClientId ? [clientId, androidClientId] : clientId;

  return { google: { clientId: audiences, clientSecret } };
}

/**
 * No SMS provider yet, and silence would be worse.
 *
 * Email now goes through `MailService` (see `mail/`); this is the stub that
 * used to sit beside it. Wiring a provider here is the same shape of change:
 * an injected sender, not a module-level client.
 */
async function deliverSms(message: {
  to: string;
  body: string;
}): Promise<void> {
  if (isProduction()) {
    throw new Error('No SMS provider is configured.');
  }

  // As above: the body is a one-time code.
  logger.debug(`sms -> ${message.to}: ${message.body}`);
  return Promise.resolve();
}
