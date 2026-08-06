# API Gateway

NestJS 11 + Fastify + Mercurius GraphQL gateway, Prisma 7 → PostgreSQL. The
entry point for the mobile client and **the owner of every piece of durable
shared state in the project** — users, sessions, readings, posts, alerts,
caregiver links, and image metadata.

It also presigns S3 uploads and bridges to the FastAPI AI service over Redis
pub/sub.

| | |
| --- | --- |
| GraphQL endpoint | `POST /graphql` |
| GraphiQL UI | `GET /graphiql` — env-gated, see below |
| Asset links | `GET /.well-known/assetlinks.json` |

There is no REST health route. Use the public `hello` query as a liveness
probe.

## Quick start

```bash
# from server/app/api-gateway/
pnpm install
cp .env.example .env       # fill in DATABASE_URL, JWT_SECRET, S3_*
pnpm prisma migrate dev    # create the schema (first run)
pnpm start:dev             # hot reload on port 3000
```

Check it came up:

```bash
curl -s http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ hello }"}'
# {"data":{"hello":"Hello from BP Monitor API!"}}
```

## Environment variables

`.env.example` is the full list. The ones that will stop you:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | The host must resolve from wherever the gateway runs. Don't use a Compose service name when running natively |
| `JWT_SECRET` | yes | — | **At least 32 characters**, genuinely random. The gateway refuses to boot below that |
| `JWT_EXPIRES_IN` | no | `7d` | Shorter for stricter environments; longer widens the exposure window of a leaked token |
| `S3_*` | if uploading | — | `S3_PROVIDER`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `S3_ENDPOINT`, `S3_DEFAULT_REGION` |
| `REDIS_URL` *or* `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | no | `localhost` / `6379` | One resolution for all three clients (`src/redis/redis-connection.ts`). `REDIS_URL` wins and is the only form carrying credentials or TLS. AI features and rate limiting both degrade quietly when Redis is unreachable — quietly enough that a wrong host looks like a working system |
| `PORT` | no | `3000` | |
| `GRAPHIQL_ENABLED` | no | — | `1` forces GraphiQL on. Unset means on everywhere except `NODE_ENV=production` |
| `BETTER_AUTH_URL` | in prod | `http://localhost:$PORT` | Origin only — `/api/auth` is appended |
| `BETTER_AUTH_SECRET` | no | falls back to `JWT_SECRET` | Set explicitly in prod so rotating one doesn't rotate both |
| `PASSKEY_RP_ID` | no | — | A bare registered domain. Passkeys are absent, not broken, when unset |
| `ANDROID_APP_SHA256_FINGERPRINT` | for passkeys | — | Comma-separated: debug, release, and Play App Signing are different keys |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Commands

```bash
pnpm start:dev                     # watch mode; regenerates src/schema.gql
pnpm build                         # nest build → dist/
pnpm start:prod                    # node dist/main
pnpm exec tsc --noEmit             # type-check

pnpm exec jest --watchman=false    # ⬅ unit tests: 18 suites / 181 tests
pnpm test:e2e                      # e2e — needs a running database

pnpm lint                          # check only
pnpm lint:fix                      # autofix

pnpm prisma generate               # regenerate the client after a schema edit
pnpm prisma migrate dev            # create + apply a migration
```

> ⚠️ Use `pnpm exec jest --watchman=false`, not `pnpm test`. The `test` script
> omits the flag, and a poisoned watchman aborts the run with `ENOSPC` before
> any test executes — which reads like a real failure rather than an
> environment one.

## Layout

```text
src/
├── main.ts                # bootstrap: Fastify, global ValidationPipe, CORS
├── app.module.ts          # GraphQL driver, errorFormatter, module wiring
├── schema.gql             # GENERATED from decorators — never edit by hand
├── auth/                  # register/login/me, JWT guard, sessions, Better Auth
├── security/              # passkey ceremonies, securityOverview
├── redis/                 # global REDIS_CLIENT + RateLimitService
├── reading/               # BP readings
├── post/ comment/ alert/  # community + alerting
├── caregiver/             # caregiver ↔ patient links
├── ai/                    # Redis bridge to ai-service + metrics logging
├── storage/               # S3 presign, confirm, orphan-sweep cron
└── prisma/                # PrismaService (global)
```

Module conventions and the file-placement rules are in
[STRUCTURE.md](./STRUCTURE.md).

## GraphQL contract

- **The schema is generated.** `src/schema.gql` comes from decorators on
  `*.types.ts` / `*.resolver.ts` via `autoSchemaFile`. Edit those, run
  `pnpm start:dev` briefly, and commit the regenerated file.
- **Client operations live per module** in `services/operations.ts` under
  `GQL_*` names — there is no central operations file.
- **The client validates against the committed schema.** `pnpm check` in
  `client/` runs `verify-graphql` against `src/schema.gql`, so a schema you
  forgot to regenerate lets a broken selection pass. See
  [CI-graphql-contract.md](../../../docs/project/CI-graphql-contract.md).
- **Errors are HTTP 200** with `{ errors: [{ message, extensions: { code } }] }`.
  `errorFormatter` in `app.module.ts` stamps `code` from the thrown
  `HttpException`'s status: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
  `BAD_USER_INPUT`, `INTERNAL_SERVER_ERROR`.

Full contract, including the operation catalogue and the image-upload flow:
[docs/reference/API.md](../../../docs/reference/API.md).

## Auth flow

1. `register` or `login` creates a `userSession` row and signs a JWT
   (`{ sub: userId, sid: sessionId }`), returning `{ token, user }`.
2. The client stores the token (SecureStore on native) and sends
   `Authorization: Bearer <token>` on every subsequent request.
3. `GqlAuthGuard` verifies the JWT, checks the session is still `isActive`,
   refreshes `lastActiveAt` (throttled to 5 minutes), and attaches the user to
   the GraphQL context.
4. `logout` flips the session to `isActive=false` server-side; the client
   clears its token.

Security notes:

- **Sessions are authoritative for revocation.** A valid unexpired token whose
  session was revoked is rejected. JWT verification alone is not enough.
- bcrypt rounds = 10 (OWASP minimum).
- **Rate limiting is one service**, `redis/rate-limit.service.ts` — atomic
  INCR + PEXPIRE in a single Lua call, persisting across restarts and shared
  between instances, falling back to a per-process counter when Redis is not
  ready. Better Auth's credential routes get 5/15min; `addCaregiverPatient`
  gets 10/10min per caregiver, to stop enumeration of which emails have
  accounts.
- **No refresh token yet** — see
  [the roadmap](../../../docs/project/api-gateway-plan.md).

The identity model and why Better Auth:
[docs/architecture/AUTH-better-auth-identity.md](../../../docs/architecture/AUTH-better-auth-identity.md).

## GraphiQL

Two independent gates, and they fail differently:

1. `GRAPHIQL_ENABLED=1` forces it on; unset means on everywhere except
   `NODE_ENV=production`.
2. In the prod stack, nginx additionally puts `/graphiql` behind HTTP Basic
   Auth.

Neither is redundant. A schema explorer with mutation access to live patient
data is not something to serve by default.

## AI service connection

The gateway publishes to the Redis channel `analyze_bp_image` and consumes
`analyze_bp_image.reply`. It presigns a GET URL at enqueue time (valid 10
minutes) so the AI service never holds S3 credentials —
[ADR-004](../../../docs/decisions/ADR-004-ai-service-holds-no-s3-credentials.md).

If Redis is down, AI features fail gracefully and everything else keeps
working. That behaviour is deliberate; don't change it without coordinating
with ai-service.

> ⚠️ These channels are typed only by convention. A field rename on one side
> with a stale deploy on the other fails **silently** — the gateway polls for
> a reply that never matches, and nothing logs an error.

## Troubleshooting

| Symptom | Usual cause |
| --- | --- |
| `getaddrinfo EAI_AGAIN <host>` | `DATABASE_URL` names a host DNS can't resolve — often a Compose service name while running natively |
| Boot fails on `JWT_SECRET` | Unset or shorter than 32 characters |
| Login returns HTTP 429 | Rate limited. The counter lives in Redis, so restarting the gateway does **not** clear it |
| `[BAD_USER_INPUT]` | class-validator rejected the input — check every `@InputType` field has a decorator |
| Schema not updating | `pnpm start:dev` regenerates `schema.gql`; restart if it's stuck |

More, including passkey configuration failures:
[docs/guides/troubleshooting.md](../../../docs/guides/troubleshooting.md).

## See also

- [AGENTS.md](./AGENTS.md) — conventions, traps, and cross-cutting concerns
- [ARCHITECTURE.md](./ARCHITECTURE.md) — request lifecycle and module graph (Thai)
- [STRUCTURE.md](./STRUCTURE.md) — where a new file goes
- [MEMORY.md](./MEMORY.md) — durable facts across sessions (Thai)
- [docs/reference/API.md](../../../docs/reference/API.md) — the GraphQL contract
- [Root AGENTS.md](../../../AGENTS.md) — monorepo rules
