# API Gateway — Claude Context

This file gives AI-assisted edits inside `server/app/api-gateway/` enough
context to act safely. It supplements the root `CLAUDE.md` and
`server/CLAUDE.md`.

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
| `src/auth/` | register/login/me, JWT guard, login throttler, sessions, password change, account deletion |
| `src/auth/auth.config.ts` | `getJwtSecret()` (fail-fast on missing/short), `JWT_EXPIRES_IN` (default `7d`), `BCRYPT_SALT_ROUNDS` |
| `src/auth/auth.guard.ts` | `GqlAuthGuard` — verifies JWT, checks session active, throttled `lastActiveAt` update |
| `src/auth/login-throttle.guard.ts` | Redis-backed rate limiter for login mutation (5/15min/phone) — atomic INCR + PEXPIRE Lua script, falls back to per-process in-memory map if Redis isn't ready |
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

## Cross-cutting concerns

- The Expo client reads error `extensions.code` to localize messages.
  `graphqlRequest` ([client/constants/api.ts](../../../client/constants/api.ts))
  throws [`GraphQLClientError`](../../../client/lib/graphql-error.ts)
  carrying `code`, `httpStatus`, and `retryAfterSec` — login/register
  dispatch those via [`formatAuthError`](../../../client/store/shared/error-format.ts)
  to inline form errors and a throttle countdown; other flows fall back
  to the legacy string-based [`formatError`](../../../client/lib/error-message.ts).
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
  metrics }`). The Python side mirrors this contract in
  [ai-service/src/ai_service/handlers.py](../../ai-service/src/ai_service/handlers.py)
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

## Pointers

- [STRUCTURE.md](./STRUCTURE.md) — feature module layout convention (DTO / types / module / resolver / service split). Follow `storage/` and `ai/` as templates.
- [README.md](./README.md) — onboarding & ops
- [AGENT.md](./AGENT.md) — agent-style architecture overview
- [PLAN.md](./PLAN.md) — roadmap and known gaps
- [MEMORY.md](./MEMORY.md) — durable facts worth remembering across sessions
- [../../docs/API.md](../../docs/API.md) — GraphQL contract reference for client developers (auth, error codes, operation catalogue, image-upload flow)
