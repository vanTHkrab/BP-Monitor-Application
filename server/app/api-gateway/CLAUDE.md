# API Gateway — Claude Context

This file gives AI-assisted edits inside `server/app/api-gateway/` enough
context to act safely. It supplements the root `CLAUDE.md`.

## What this service is

NestJS 11 + Fastify + Mercurius (GraphQL) gateway. Single entry point for the
mobile and web clients. Owns auth, persistence (Prisma + PostgreSQL), file
upload (S3), and bridging to the FastAPI AI service via Redis.

GraphQL contract is **schema-first via decorators**: `*.types.ts` /
`*.resolver.ts` are the source of truth, `src/schema.gql` is regenerated.

## Important paths

| Path | Responsibility |
|---|---|
| `src/main.ts` | bootstrap, global `ValidationPipe`, CORS, listen |
| `src/app.module.ts` | GraphQL driver config + `errorFormatter` (stamps `extensions.code`), feature module wiring |
| `src/redis/redis.module.ts` | `@Global()` provider of `REDIS_CLIENT` (ioredis). Lazy-connects + suppresses errors — consumers check `redis.status === 'ready'` and degrade if not |
| `src/redis/rate-limit.service.ts` | `RateLimitService` — the project's one rate limiter. Fixed window **by decision, not by omission** (A-008: the boundary burst of 2x `max` was weighed and accepted; the doc comment above `CONSUME` holds the rationale and the revisit triggers — don't "fix" it to a sliding window), atomic INCR + PEXPIRE in a single Lua call, falls back to a per-process counter if Redis isn't ready. Exported by the `@Global()` `RedisModule`, so inject it rather than writing a second INCR against `REDIS_CLIENT`. Used by Better Auth's credential routes (5/15min) via `betterAuthStorage()` and by `addCaregiverPatient` (10/10min per caregiver). Replaced the old `src/auth/login-throttle.guard.ts`, which no longer exists |
| `src/auth/` | register/login/me, JWT guard, sessions, password change, account deletion. Rate limiting is configured here (`better-auth.ts`) but implemented in `src/redis/` |
| `src/auth/auth.config.ts` | `getJwtSecret()` (fail-fast on missing/short), `JWT_EXPIRES_IN` (default `7d`), `BCRYPT_SALT_ROUNDS` |
| `src/auth/auth.guard.ts` | `GqlAuthGuard` — verifies JWT, checks session active, throttled `lastActiveAt` update |
| `src/auth/android-origin.ts` | Converts keytool SHA-256 fingerprints into the `android:apk-key-hash:` WebAuthn origins Android actually presents. Separate file so it is unit-testable — `better-auth.ts` imports ESM-only packages the CJS Jest setup cannot load |
| `src/security/` | Passkey ceremonies (register + authenticate), passkey list/rename/delete, and `securityOverview` for the mobile security screen. Split from `auth/` on the line "getting in" vs "managing how you get in" |
| `src/well-known.controller.ts` | Serves `/.well-known/assetlinks.json` from `ANDROID_APP_SHA256_FINGERPRINT` — Android will not accept a passkey without it. Must be reachable on the **RP domain**, not just on the gateway's host |
| `src/reading/`, `src/post/`, `src/comment/`, `src/alert/`, `src/caregiver/` | feature modules — same shape: `*.module.ts`, `*.resolver.ts`, `*.service.ts`, `*.types.ts` |
| `src/ai/` | bridges GraphQL to AI service over Redis transport |
| `src/storage/` | S3 upload helpers (profile + BP image) + `StorageCleanupService` (`@Cron` daily orphan-image sweep) |
| `src/prisma/` | `PrismaService` (extends PrismaClient), `prisma.module.ts` is global |
| `prisma/schema.prisma` | DB schema. After edits run `pnpm prisma migrate dev` |
| `test/` | e2e tests |

## Run / build / verify

```bash
pnpm start:dev                # hot-reload
pnpm build                    # tsc → dist/
pnpm exec tsc --noEmit        # type-check only
pnpm test                     # unit
pnpm test:e2e                 # e2e (needs DB)
pnpm prisma migrate dev       # apply pending migrations
```

## Architectural conventions

- **Schema-first via decorators.** Adding a query/mutation = update the
  resolver + types file. Do **not** hand-edit `src/schema.gql` — it's
  regenerated on boot by `autoSchemaFile`.
- **GraphiQL is env-gated.** `graphiql` in `app.module.ts` resolves from
  `GRAPHIQL_ENABLED` (`1` = on), defaulting to on everywhere except
  `NODE_ENV=production`. Dev is unaffected; a prod deploy does not serve a
  mutation-capable schema explorer unless someone opts in. The prod nginx
  config additionally puts `/graphiql` behind HTTP Basic Auth
  (`infra/nginx/templates/default.conf.template`) — don't treat either gate
  as redundant, they fail differently.
- **Module shape.** Feature modules expose `XxxResolver` (GraphQL surface),
  `XxxService` (business logic), and `xxx.types.ts` (GraphQL `@ObjectType` /
  `@InputType` + class-validator decorators). The service injects
  `PrismaService`. The resolver injects the service.
- **Validation.** Inputs go through global `ValidationPipe` configured in
  `main.ts` (`whitelist`, `forbidNonWhitelisted`, `transform`). Add
  class-validator decorators to every `@InputType` field — including
  enums (`@IsEnum(MyEnum)`). `@Field(() => MyEnum)` alone is GraphQL
  metadata only; without a class-validator decorator the field is
  non-whitelisted and `forbidNonWhitelisted` will 400 the request before
  it ever reaches the resolver. Don't validate manually inside
  resolvers/services — let the pipe do it.
- **Errors.** Throw NestJS HttpException subclasses (`UnauthorizedException`,
  `ForbiddenException`, `ConflictException`, `BadRequestException`,
  `NotFoundException`). The `errorFormatter` in `app.module.ts` maps the
  HTTP status to a string `extensions.code` that the client keys off of.
  Don't return error objects from resolvers; throw.
- **Auth on resolvers.** Anything that needs a logged-in user uses
  `@UseGuards(GqlAuthGuard)` + `@CurrentUser()` decorator. Public
  resolvers (login, register, hello) skip the guard.
- **Auth tokens** are signed via `signToken()` in `AuthService`, using
  `getJwtSecret()` from `auth.config.ts`. Never read `process.env.JWT_SECRET`
  directly — that bypasses the fail-fast checks.
- **Sessions are revocable.** Every authenticated request validates the
  session in `userSession` table. Logout flips `isActive=false` rather than
  deleting the row (history kept for the "login sessions" screen).
- **DB writes throttled.** `GqlAuthGuard` only refreshes `lastActiveAt` if
  ≥ 5 min have passed. Don't add per-request writes elsewhere either.
- **Prisma.** Always use `PrismaService` (DI-injected). Composite operations
  that must succeed atomically must use `prisma.$transaction([...])`.
- **Redis is optional at boot.** The factory in `app.module.ts` swallows
  connection errors and lazy-connects, so AI features degrade gracefully if
  Redis is down. Don't change that behavior without coordinating with
  ai-service.

## Working rules for Claude

- **One feature module per change.** Don't touch `auth/`, `reading/`, and
  `post/` in the same diff unless the task spans them.
- **Update `*.types.ts` first** when adding a field. Run `pnpm start:dev`
  briefly to regenerate `schema.gql`, then commit both.
- **Don't edit `src/schema.gql` by hand.** It will be overwritten.
- **Don't introduce a new way to read JWT secret.** Use `getJwtSecret()`.
- **Don't add `console.log` in resolvers/services.** Throw with a clear
  Thai-localized message in HttpException; the client handles formatting.
- **Don't hardcode role checks as strings scattered across the codebase.**
  If you add admin features, add a single helper.
- **Don't bypass `ValidationPipe` with `any`.** If a field is genuinely
  free-form, use `@IsString()` + `@MaxLength()` at minimum.
- **Don't migrate the DB without `pnpm prisma migrate dev`.** Manually
  editing the database in dev causes drift.
- **No tests yet for `auth/`** — when adding behavior, add at least a unit
  test for the service path (see PLAN.md).

## Passkeys and on-device Google sign-in

Both are env-gated and absent rather than broken when unconfigured. The
traps, in the order people hit them:

- **`PASSKEY_RP_ID` must be a bare registered domain.** Not an IP, not a
  port, not a scheme. Passkeys therefore cannot work against a LAN dev
  address at all — the failure is at the authenticator, before any request
  reaches this service. The plugin is simply not loaded when it is unset,
  and `securityOverview.passkeySupported` reports that to the client.
- **Android does not send `https://<domain>` as the WebAuthn origin.** It
  sends `android:apk-key-hash:<base64url sha256 of the signing cert>`.
  `android-origin.ts` derives that from `ANDROID_APP_SHA256_FINGERPRINT`
  so the .env holds one value in keytool's format. Configuring only the
  https origin fails every registration with a mismatched-origin error
  that reads like a server bug.
- **`/.well-known/assetlinks.json` has to be on the RP domain.** Serving it
  from `api.example.com` while the RP is `example.com` means Android never
  sees it. Google's servers fetch it, not the app, so it must be public
  and real-HTTPS.
- **Debug, release, and Play App Signing are three different keys.**
  `ANDROID_APP_SHA256_FINGERPRINT` is comma-separated for that reason; a
  passkey works only on builds whose key is listed.
- **One Tap is not Better Auth's `oneTap` plugin.** That plugin drives
  Google Identity Services in a browser. On Android the picker is
  Credential Manager, which returns an ID token; `loginWithGoogle`
  exchanges it through `signInSocial`. `GOOGLE_ANDROID_CLIENT_ID` is
  added to the provider's `clientId` array as a second accepted
  *audience* — the array's first entry stays the web client, because that
  is what the browser redirect uses as `client_id`.
- **The challenge is a cookie.** See the `challengeToken` note in
  [docs/reference/API.md](../../../docs/reference/API.md#511-passkeys--security)
  before changing anything in `src/security/`.

## Cross-cutting concerns

- The Expo client reads error `extensions.code` to localize messages.
  `graphqlRequest` ([client/src/services/api.ts](../../../client/src/services/api.ts))
  throws [`ApiError`](../../../client/src/services/api-error.ts)
  carrying `code`, `httpStatus`, and `retryAfterSec` — auth flows dispatch
  those via [`formatAuthError`](../../../client/src/modules/auth/lib/errors.ts)
  to inline form errors and a throttle countdown; other flows fall back
  to the string-based [`formatErrorMessage`](../../../client/src/lib/error-message.ts).
  When you throw a new exception type, make sure its HTTP status maps to
  the code the client expects, or extend the mapping in both places.
- The mobile client also reads the standard `Retry-After` response header
  when present and uses it to drive a live "please wait N seconds"
  countdown for the login throttle. The current throttle returns
  `retryAfterSec` in the HttpException body (lifted into
  `extensions.retryAfterSec` by `errorFormatter`); setting a real
  `Retry-After: <seconds>` header on the 429 response would let
  proxies/clients that don't parse GraphQL extensions still cooperate.
- The web dashboard hits the same GraphQL endpoint. Any breaking schema
  change ships to two clients.
- The AI service expects payloads on the Redis channel `analyze_bp_image`
  with the shape produced by `src/ai/ai.process.ts` (`{ jobId, userId,
  s3Key, imageUrl, mimeType, ocrEngine? }` — `imageUrl` is a presigned
  GET URL that `AiService.enqueueFromKey` generates via
  `S3StorageClient.presignGet` at enqueue time, valid for 10 minutes;
  `ocrEngine` is optional and originates from a dev-gated client
  picker). Replies come back on `analyze_bp_image.reply` and are
  consumed in `ai.process.ts` too (`{ confidence, systolic, diastolic,
  pulse, raw_text, roi_image_url, model_version, status, engine,
  metrics, image_quality_score }`). `image_quality_score` is a float
  in [0, 1] or `null`; when non-null, `AiProcessor` writes it back to
  `Image.image_quality_score` via `prisma.image.updateMany({ where:
  { s3Key }, ... })` so quality metadata lives next to the s3Key it
  describes. `updateMany` (not `update`) is used so a missing Image
  row — already swept by the cleanup cron — does not fail the
  analysis. The Python side mirrors this contract in
  [ai-service/src/ai_service/handlers.py](../ai-service/src/ai_service/handlers.py)
  — changing one side requires updating the other.
- M2.2 telemetry — when ai-service replies with `engine` + `metrics`,
  `AiProcessor` forwards a JSONL row to S3 via
  [`MetricsLogger`](./src/ai/metrics-logger.ts) at
  `metrics/ocr-comparison/{YYYY-MM-DD}.jsonl`. The writer uses
  get-and-rewrite (S3 has no native append); the AiProcessor swallows
  logger errors so telemetry never blocks analysis. The bucket comes
  from `S3StorageClient`, so no new env var is needed. If concurrent
  workers race the same daily file, switch to one-file-per-analysis
  before raising throughput.
- `metrics.rectify_ms` — covers the 4-point LCD perspective
  rectification + the second YOLO pass on the rectified image
  (ai-service `analyzer.rectify`). `0` indicates rectification was
  skipped (no screen-class bbox) or fell back silently (no quad,
  warp degenerate, second pass lost fields). Required by
  `parseMetrics`; adding a numeric field to ai-service that the
  gateway doesn't recognise still drops the whole `metrics` payload
  to `null`, so wire-shape changes need both sides updated together.

## Pointers

- [STRUCTURE.md](./STRUCTURE.md) — feature module layout convention (DTO / types / module / resolver / service split). Follow `storage/` and `ai/` as templates.
- [README.md](./README.md) — onboarding & ops
- [AGENT.md](./AGENT.md) — agent-style architecture overview
- [PLAN.md](../../../docs/project/api-gateway-plan.md) — roadmap and known gaps
- [MEMORY.md](./MEMORY.md) — durable facts worth remembering across sessions
- [../../../docs/reference/API.md](../../../docs/reference/API.md) — GraphQL contract reference for client developers (auth, error codes, operation catalogue, image-upload flow)
