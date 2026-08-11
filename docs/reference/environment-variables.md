---
title: Environment variables
description: Every environment variable this monorepo reads, per file, with what it does and how to obtain it.
status: current
updated: 2026-08-06
owner: cross
---

# Environment variables

Every environment variable this monorepo reads, per file, with what it does
and how to obtain it. Each app has its own `.env`; there is no root manifest
and no shared loader — a value used by two apps must be written into both
files.

> ⚠️ Source of truth is each app's `.env.example`; this page summarises them.
> When a variable is added or removed, update both.

There are **three** environment files that feed a running backend, not two, and
they are not variants of each other:

| File | Feeds | Notes |
| --- | --- | --- |
| `server/app/ai-service/.env`, `server/app/api-gateway/.env` | a bare `pnpm start:dev` / `uv run` | no container involved |
| [`infra/docker-compose/.env`](#docker-compose--development) | the **development** Compose stack | includes a Postgres container and the `web` dashboard |
| [`infra/podman/bp-monitor.env`](#production--podman-on-ec2) | the **production** EC2 host | plus six Podman secrets that are deliberately *not* in it |

---

## Outstanding — needed before passkeys and Google One Tap work

The security work is merged and inert: the gateway does not load the passkey
plugin without an RP ID, and the mobile app hides both buttons rather than
showing them broken. Filling these four turns the feature on.

1. `PASSKEY_RP_ID` — the HTTPS domain. Must be a bare registered domain,
   never an IP or a port, so a LAN dev address cannot be used. It must be the
   **same host that serves `/.well-known/assetlinks.json`**, which the gateway
   does on `DOMAIN_NAME` — so on this deploy it is `api.example.com`, not the
   bare apex.
2. `ANDROID_APP_SHA256_FINGERPRINT` — from
   `keytool -list -v -keystore <path> -alias <alias>`. Comma-separate debug,
   release, and Play App Signing keys.
3. `GOOGLE_ANDROID_CLIENT_ID` (gateway) — Android OAuth client, created
   against the same SHA-1 fingerprint of the keystore.
4. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (client) — the **web** client ID, not
   the Android one. Credential Manager mints a token whose audience is the
   web client.

---

## API Gateway

`server/app/api-gateway/.env` —
[`.env.example`](../../server/app/api-gateway/.env.example)

The only service holding durable state. Several values fail fast at boot
rather than degrading — a missing `JWT_SECRET` or a `BETTER_AUTH_URL` with a
path in it refuses to start, on purpose.

| Variable | Status | Description |
| --- | --- | --- |
| `DATABASE_URL` | Required | PostgreSQL connection string. Prisma owns the schema here; this is the source of truth for every other store. |
| `PORT` | Optional | Defaults to `3000`. Also the port `BETTER_AUTH_URL` falls back to in development. |
| `NODE_ENV` | Optional | Compared case-insensitively after trimming, so `production`, `PRODUCTION`, and `Production` are all production. Anything else — including `prod` and unset — counts as development, which is what lets the SMS stub, and email with no `SMTP_HOST` configured, log the one-time code instead of throwing. Every gate reads it through `isProduction()` in `server/app/api-gateway/src/env.ts`; that is the only place it is read. |
| `GRAPHIQL_ENABLED` | Prod care | `1`, `true`, `yes`, or `on` (case-insensitive, trimmed) forces the schema explorer on. Any other non-empty value forces it off — the accepted set is a closed allowlist, so an unrecognised value or a typo fails safe rather than being read as truthy. It has full mutation access to the live database — leave unset in production, where it defaults off. |
| `JWT_SECRET` | Required | Minimum 32 characters; the gateway refuses to boot on a shorter one. Also the fallback for `BETTER_AUTH_SECRET`. |
| `JWT_EXPIRES_IN` | Optional | Defaults to `7d`. |
| `BETTER_AUTH_URL` | Prod required | **Origin only.** `/api/auth` is appended automatically; any other path is discarded with a warning. Getting this wrong costs nothing at boot and 404s every auth route afterwards. |
| `BETTER_AUTH_SECRET` | Optional | Falls back to `JWT_SECRET`. Set it explicitly in production so rotating one does not silently rotate the other. |
| `HAVE_I_BEEN_PWNED_ENABLED` | Optional | `true` rejects passwords found in known breaches. Adds an outbound call to the sign-up path. |
| `REDIS_URL` · `REDIS_HOST` · `REDIS_PORT` · `REDIS_PASSWORD` | Optional | Transport to the AI service and Better Auth's rate-limit store. Provide either `REDIS_URL` or the host/port pair; the URL wins when both are set, and is the only form that can carry credentials or TLS. Redis is optional at boot — an unreachable server degrades to per-process limiting rather than failing requests. |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | Optional | The **web** OAuth credentials. Google sign-in stays unregistered until both are set, so it reads as "not set up here" rather than breaking at the redirect. |
| `GOOGLE_ANDROID_CLIENT_ID` | New | The Android OAuth client, added as a second accepted **audience** — not a second provider. Without it, every mobile Google sign-in fails as an invalid token while the web flow keeps working. |
| `PASSKEY_RP_ID` | New | A bare registered domain, e.g. `bp.example.com`. Never an IP, port, or scheme — the gateway throws at boot on those. **Unset means the passkey plugin is not loaded at all**, and `securityOverview.passkeySupported` reports false so the app hides the section. |
| `PASSKEY_RP_NAME` | Optional | The name the system passkey sheet shows. Defaults to `BP Monitor`. |
| `ANDROID_APP_SHA256_FINGERPRINT` | New | Keytool's 32 colon-separated hex bytes. Used twice: served in `/.well-known/assetlinks.json`, and converted into the `android:apk-key-hash:` origin Android actually presents — it does **not** send `https://<domain>`. Comma-separate debug, release, and Play App Signing keys; a passkey works only on builds whose key is listed. |
| `S3_ENDPOINT` · `S3_BUCKET_NAME` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | Required | Object storage for avatars and BP images. Production target is Cloudflare R2; staging points at Supabase Storage's S3 endpoint with the same env shape. These four are the ones [`s3.config.ts`](../../server/app/api-gateway/src/storage/s3.config.ts) throws on when missing. |
| `S3_PROVIDER` · `S3_DEFAULT_REGION` · `S3_USE_PATH_STYLE_ENDPOINT` · `S3_PUBLIC_BASE_URL` | Optional | Same object storage, non-fatal knobs. `S3_DEFAULT_REGION` defaults to `auto`; `S3_USE_PATH_STYLE_ENDPOINT` is path-style only on the literal string `true`; `S3_PUBLIC_BASE_URL` falls back to a host derived from `S3_ENDPOINT` when unset. |
| `ANDROID_APP_PACKAGE_NAME` | Optional | Defaults to `com.project.bpmobile`. Must match `expo.android.package` in `client/app.json`. |
| `EXPO_ACCESS_TOKEN` | Prod care | Expo access token for push delivery ([Expo dashboard](https://expo.dev/) → Account → Access tokens). Unset, Expo accepts a send from anyone holding one of our push tokens; set, only requests carrying this token are honoured. Optional by design so a fresh checkout can send in development — set it in production. Push works without it; nothing fails at boot. |
| `SMTP_HOST` | Prod required | The SMTP relay. **Unset is a real mode, not an oversight:** the gateway logs the reset link or one-time code in development so a fresh checkout works, and throws in production rather than dropping a credential silently. Email verification and password reset are the only senders. Resend is `smtp.resend.com`; the dev stack's Mailpit is `mailpit`. See [email-delivery-setup.md](../guides/email-delivery-setup.md). |
| `SMTP_PORT` | Optional | Defaults to `587` (STARTTLS). `465` selects implicit TLS; nothing else changes behaviour, and a non-numeric value throws at the first send rather than reaching nodemailer as `NaN`. Outbound `25` is blocked at the cloud-provider level, outside Docker — the symptom is `ETIMEDOUT`, which reads like a network fault. |
| `SMTP_USER` | Optional | Unset omits SMTP AUTH **entirely** rather than sending empty credentials, which is what lets a local Mailpit with no AUTH work. For Resend this is the literal string `resend`, not an email address. |
| `SMTP_PASSWORD` | Optional | Ignored unless `SMTP_USER` is set. For Resend, an API key with Sending access. |
| `MAIL_FROM` | Prod required | The `From` header, e.g. `BP Monitor <no-reply@example.com>`. Its domain must be verified with the provider or every send is rejected. Unset falls back to a placeholder that any real provider refuses — loudly, at the first send. |

> ⚠️ That graceful degradation is also how a misconfiguration hides. Until
> 2026-08-06 the rate-limit client ignored these variables entirely and
> connected to `localhost`, so every container silently limited per-pod
> instead of globally, with nothing in a log to say so. If a limit behaves as
> though it is not shared, check that the client is actually connected before
> assuming the limiter is wrong.

---

## Mobile client

`client/.env` — [`.env.example`](../../client/.env.example)

Only `EXPO_PUBLIC_*` variables reach the app bundle — and everything in that
bundle is readable by anyone holding the APK. Never put a secret here; both
values below are public identifiers by design.

| Variable | Status | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_API_URL` | Required | Full GraphQL endpoint **including `/graphql`**. In Expo Go it falls back to the bundler's LAN host; a release build has no Expo host, so it throws rather than silently defaulting to localhost. |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | New | The **web** client ID, even though this is the Android app. This is the counter-intuitive part of the setup: Credential Manager mints an ID token whose audience is the web client, and the Android client ID exists only to tie the request to the app's signing certificate. Putting the Android ID here yields a token the gateway rejects. Unset hides the Google button rather than breaking it on tap. |

```bash
# client/.env — pick the one that matches where the gateway runs
EXPO_PUBLIC_API_URL=http://192.168.1.10:3000/graphql   # LAN dev
EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/graphql       # Android emulator → host
EXPO_PUBLIC_API_URL=https://api.example.com/graphql    # production
```

---

## AI service

`server/app/ai-service/.env` —
[`.env.example`](../../server/app/ai-service/.env.example)

| Variable | Status | Description |
| --- | --- | --- |
| `AI_MODELS_R2_BASE_URL` | Required | Public R2 base URL hosting the OCR model artifacts. Both the Docker entrypoint and the local fetcher download `$AI_MODELS_R2_BASE_URL/<filename>` and verify against `models/EXPECTED_HASHES.json`. The shipped placeholder is **rejected at start time on purpose** — replace it before the first run. `crnn.pt` lives in R2 as a training artifact only and is not fetched at runtime. |

> **Note:** `.env.example` lists only the variable above, but the service also
> reads `REDIS_URL` (default `redis://localhost:6379`) and `LOG_LEVEL`
> (default `INFO`) in
> [`main.py`'s `lifespan()`](../../server/app/ai-service/src/ai_service/main.py),
> plus the `AI_*` pipeline knobs defined in
> [`config.py`](../../server/app/ai-service/src/ai_service/config.py)
> (`AI_MODELS_DIR`, `AI_DEFAULT_ENGINE`, `AI_DEVICE_MODE`,
> `AI_DEBUG_DUMP_ENABLED`, timeouts, ORT thread caps). All have working
> defaults; `REDIS_URL` is the one to set when Redis is not on localhost.

---

## Web dashboard — development only

`web/.env` — [`.env.example`](../../web/.env.example). Copy it to `.env.local`.

> ⚠️ **This app is not deployed.** It has no authentication of its own — no auth
> library is installed — and its `/admin/` pages open direct connections to
> Postgres, Redis and S3 to render session counts and user totals. The only
> thing that ever guarded them was an nginx Basic Auth rule, and that rule is
> gone with the route. It is defined in `docker-compose.dev.yml` and nowhere
> else, so it cannot start in the prod-shaped or production stacks. Run it
> locally; point it at production datastores with a local `.env.local` if you
> need to, but do not host it.

Mostly health probes and read paths. The database connection is used for
status checks only — a read-only role is enough and is the safer choice.

| Variable | Status | Description |
| --- | --- | --- |
| `GATEWAY_URL` | Optional | Base URL of the api-gateway, used by `lib/gateway.ts`. Defaults to `http://localhost:3000`, which is wrong inside a container — Compose overrides it with the service name. |
| `AI_SERVICE_URL` | Optional | Base URL of the FastAPI service, used by `lib/ai-service.ts` for `/health`. Defaults to `http://localhost:8000`, with the same container caveat. |
| `DATABASE_URL` | Required | Same connection string as the gateway. `SELECT` is sufficient for the health probes used here. |
| `REDIS_URL` · `REDIS_HOST` · `REDIS_PORT` · `REDIS_PASSWORD` | Optional | Provide either `REDIS_URL` or the host/port pair. The URL wins when both are set. |
| `S3_BUCKET_NAME` · `S3_ENDPOINT` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | Required | Same object storage as the gateway. |
| `S3_PROVIDER` · `S3_DEFAULT_REGION` · `S3_USE_PATH_STYLE_ENDPOINT` | Optional | The provider value determines how the client is constructed (`cloudflare` \| `aws` \| `minio` \| `digitalocean`) and defaults to `cloudflare`. `S3_DEFAULT_REGION` defaults to `auto` and is also read as `S3_REGION`. |

---

## Docker Compose — development

`infra/docker-compose/.env` —
[`.env.example`](../../infra/docker-compose/.env.example)

Feeds the development stack and the prod-shaped rehearsal stack. Values here are
injected into the services, so they must agree with the per-app files above when
both paths are in use.

| Variable | Status | Description |
| --- | --- | --- |
| `POSTGRES_USER` · `POSTGRES_PASSWORD` · `POSTGRES_DB` | Required | Credentials the `postgres` service is created with. `DATABASE_URL` below must repeat them — they are not derived. |
| `DATABASE_URL` | Required | Keep the host as `postgres` — the compose service name, not `localhost`, which inside a container points at the container itself. |
| `JWT_SECRET` · `JWT_EXPIRES_IN` | Required | Passed through to the gateway. Changing `JWT_SECRET` invalidates every live session. |
| `BETTER_AUTH_URL` | Required | **Origin only.** Forwarded by `docker-compose.yml` since 2026-08-09; before that it was not, and every route under `/api/auth` 404'd in every containerised environment. That includes the mobile app's email-OTP calls. |
| `BETTER_AUTH_SECRET` · `PASSKEY_*` · `GOOGLE_*` · `ANDROID_APP_*` · `EXPO_ACCESS_TOKEN` · `HAVE_I_BEEN_PWNED_ENABLED` | Optional | Also newly forwarded. Each is absent-not-broken when unset, which is why they went unnoticed. See the API Gateway table above for what each one does. |
| `BCRYPT_SALT_ROUNDS` | Inert | Forwarded to the gateway by `docker-compose.yml`, but the gateway ignores it — the value is the hard-coded constant `10` in [`auth.config.ts`](../../server/app/api-gateway/src/auth/auth.config.ts). Changing it here has no effect, and it does not invalidate existing hashes. |
| `NEXT_PUBLIC_API_URL` | Inert | Declared on the `web` service, but nothing under `web/src/` reads it — the dashboard talks to the gateway server-side via `GATEWAY_URL`, which Compose sets to the service name directly. Public if it ever ships: it would go to the browser. |
| `DOMAIN_NAME` | Prod-shaped only | nginx's `server_name`. The block is `default_server`, so a mismatch does not 404 — what actually routes traffic is the Cloudflare tunnel's Public Hostname. No DNS record of your own is needed. |
| `TUNNEL_TOKEN` | Prod-shaped only | The Cloudflare Tunnel credential — on its own, enough to publish traffic into the stack's network. **Leave it empty when rehearsing locally**: a real token publishes your laptop on a real hostname. In production it is a Podman secret, never a file. |
| `GRAPHIQL_ENABLED` | Prod care | Leave `0` on any internet-facing host. nginx keeps `/graphiql` behind Basic Auth either way, but the two gates fail differently — neither is redundant. |
| `AI_MODELS_R2_BASE_URL` | Required | Same value as the AI service's own file. `docker-entrypoint.sh` refuses to start on the placeholder. |
| `S3_PROVIDER` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` · `S3_DEFAULT_REGION` · `S3_BUCKET_NAME` · `S3_ENDPOINT` · `S3_USE_PATH_STYLE_ENDPOINT` · `S3_PUBLIC_BASE_URL` | Required | Consumed by the gateway's StorageModule, and by the dev dashboard's own S3 client. The `.env.example` carries worked Supabase-staging and Cloudflare-R2-production examples. |

> **Removed:** `CERTBOT_EMAIL` and `CERTBOT_STAGING`. TLS terminates at
> Cloudflare's edge; there is no certbot service, no ACME challenge, and no port
> 443 in any of these stacks. `infra/scripts/init-letsencrypt.sh` is gone.

---

## Production — Podman on EC2

`/etc/bp-monitor/bp-monitor.env` on the host —
[`bp-monitor.env.example`](../../infra/podman/bp-monitor.env.example)

This is the file the real deploy reads. It is **not** a copy of the Compose one:
there is no Postgres container, no `web` service, and the credentials are not in
it at all.

### Podman secrets — the six values that are not in the env file

Injected into the container process environment by name, stored at mode 0600
under the deploy user's Podman store, never written to an image layer or a bind
mount. Create them once per host (see
[deploy.md](../guides/deploy.md#configuration-and-secrets)).

| Secret | Target variable | Notes |
| --- | --- | --- |
| `bp-database-url` | `DATABASE_URL` (api-gateway) | Supabase **transaction** pooler, port **6543**. Running app traffic on the direct endpoint exhausts the connection ceiling. |
| `bp-database-url-direct` | `DATABASE_URL` (`bp-migrate.service` only) | Direct or **session** pooler, port **5432**. Prisma's migrate engine needs an advisory lock held across statements, which a transaction pooler cannot hold. Same variable name, different endpoint, for the length of one container run. |
| `bp-jwt-secret` | `JWT_SECRET` | 32+ chars; the gateway refuses to boot on a shorter one. |
| `bp-s3-access-key-id` | `S3_ACCESS_KEY_ID` | |
| `bp-s3-secret-access-key` | `S3_SECRET_ACCESS_KEY` | |
| `bp-tunnel-token` | `TUNNEL_TOKEN` (cloudflared) | The tunnel credential. Anyone holding it can publish traffic into `bp-net`. |

### Non-secret configuration

| Variable | Status | Description |
| --- | --- | --- |
| `BP_IMAGE_TAG` | Required | The tag `build-images.sh` produced, normally a git short SHA. `bp-migrate.service` uses it so the migration runs from the same build as the deploy; the `.container` units reference `:latest`. **This is your rollback target — record it.** |
| `DOMAIN_NAME` | Required | The hostname clients use, e.g. `api.example.com`. nginx uses it only for `server_name`. What actually routes traffic is the tunnel's Public Hostname row in the Cloudflare dashboard, which nothing in this repo can verify — keep the two in step by hand. If they disagree, every container is healthy and the site is down. |
| `BETTER_AUTH_URL` | Required | Origin only, https, and it must match `DOMAIN_NAME`. Unset or wrong, every route under `/api/auth` 404s — including the mobile app's email-OTP verification — with nothing failing at boot. |
| `GRAPHIQL_ENABLED` · `JWT_EXPIRES_IN` | Optional | As above. Leave `GRAPHIQL_ENABLED=0`. |
| `PASSKEY_RP_ID` · `PASSKEY_RP_NAME` · `ANDROID_APP_PACKAGE_NAME` · `ANDROID_APP_SHA256_FINGERPRINT` | Optional | Passkeys. `PASSKEY_RP_ID` must equal the domain serving `/.well-known/assetlinks.json` — which here is `DOMAIN_NAME`, because the gateway serves it. Setting it to a bare parent domain silently breaks Android. |
| `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_ANDROID_CLIENT_ID` | Optional | Google sign-in. Absent, not broken, when unset. |
| `EXPO_ACCESS_TOKEN` | Prod care | Unset, Expo accepts a push send from anyone holding one of our push tokens. Push works either way and nothing fails at boot — set it here precisely because the failure is invisible. |
| `HAVE_I_BEEN_PWNED_ENABLED` | Optional | `true` rejects breached passwords. Adds an outbound call to sign-up. |
| `SMTP_HOST` · `SMTP_PORT` · `SMTP_USER` · `MAIL_FROM` | Required | Email delivery. `NODE_ENV=production` here, so an unset `SMTP_HOST` makes **every** password-reset and verification send throw — the two mobile screens fail with a server error rather than a missing email. `MAIL_FROM`'s domain must be verified with the provider. Port 587 or 465 only; outbound 25 is blocked by the cloud provider, and the symptom is a timeout that reads like a network fault. |
| `SMTP_PASSWORD` | Required | The provider API key (Resend: an API key with Sending access). **A credential living in the env file rather than a Podman secret** — unlike `JWT_SECRET` and the S3 keys above. Worth moving when a secret is next added; until then, the env file's 0600 permissions are the only thing protecting it. |
| `AI_MODELS_R2_BASE_URL` | Required | ai-service refuses to start on the placeholder. Needs outbound HTTPS. |
| `S3_PROVIDER` · `S3_ENDPOINT` · `S3_BUCKET_NAME` · `S3_DEFAULT_REGION` · `S3_USE_PATH_STYLE_ENDPOINT` · `S3_PUBLIC_BASE_URL` | Required | The non-secret half of the object-storage config; the key and secret are Podman secrets. |

> **Not in this file, deliberately:** `CERTBOT_*` (no certbot — TLS is at
> Cloudflare), `NEXT_PUBLIC_API_URL` (the dashboard is not deployed),
> `BCRYPT_SALT_ROUNDS` (always was inert), and `POSTGRES_*` (Postgres is
> Supabase, not a container).

---

## Values that must agree across files

There is no shared loader, so nothing enforces these. Each row is a pair that
drifts silently — the symptom appears somewhere other than the file that is
wrong.

| Value | Files | What drift looks like |
| --- | --- | --- |
| `DATABASE_URL` | gateway · compose · podman secret | The dev dashboard's health probes report a database the gateway is not writing to. |
| `S3_*` | gateway · web · compose · podman | Images upload successfully and then 404 when the other side signs a URL against a different bucket. |
| `AI_MODELS_R2_BASE_URL` | ai-service · compose · podman | Local dev and Docker fetch different model builds, so on-device and backend OCR disagree. |
| Google web client ID | gateway `GOOGLE_CLIENT_ID` · client `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Every mobile Google sign-in fails as an invalid token; the web flow keeps working, so it looks like a broken mobile build. |
| Android package name | gateway `ANDROID_APP_PACKAGE_NAME` · `client/app.json` | Android fetches `assetlinks.json`, finds a different package, and rejects the passkey with no useful message. |
| Passkey domain | gateway `PASSKEY_RP_ID` · `DOMAIN_NAME` | The gateway serves `/.well-known/assetlinks.json` on `DOMAIN_NAME`, so the RP ID must be that exact host. With `DOMAIN_NAME=api.example.com`, an RP ID of `example.com` sends Android to a host this stack does not serve. |
| API origin | podman `DOMAIN_NAME` · `BETTER_AUTH_URL` · client `EXPO_PUBLIC_API_URL` · the tunnel's **Public Hostname** | Three of the four are in this repo; the fourth is a row in the Cloudflare dashboard that no diff records. Drift there is the one failure where every container is healthy and the site is down. |
| Tunnel origin service | the tunnel's Public Hostname URL · the `nginx` container name | It must read `HTTP://nginx:80`. Pointed at `api-gateway:3000` instead, the site works — and the `/graphiql` Basic Auth gate and the per-IP flood guard are both silently gone. |

---

## See also

- [guides/setup.md](../guides/setup.md) — which `.env` to copy first and the
  minimum each app needs to boot
- [infra/README.md](../../infra/README.md) — the Compose stack these values
  feed
