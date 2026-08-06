# infra

Infrastructure assets for running the BP Monitor backend + web locally and in
deployable environments via Docker Compose.

The mobile **client** is **not** containerised — it runs on Expo directly.

## Layout

```text
infra/
├── docker-compose/
│   ├── docker-compose.yml          # base services: postgres, redis, api-gateway, ai-service, web
│   ├── docker-compose.dev.yml      # override: hot-reload, volume mounts, exposed DB ports
│   ├── docker-compose.prod.yml     # override: build target=prod, restart policy, nginx + certbot
│   └── .env.example                # copy to .env, fill in real values
├── nginx/
│   ├── templates/
│   │   └── default.conf.template   # envsubst'd into /etc/nginx/conf.d/default.conf at container start
│   ├── auth/                       # Basic Auth credentials for the public demo gate — .htpasswd is gitignored
│   └── reload-loop.sh              # nginx entrypoint override — periodic config/cert reload
├── certbot/
│   └── renew-loop.sh               # certbot entrypoint override — periodic `certbot renew`
├── scripts/
│   └── init-letsencrypt.sh         # ONE-TIME first-cert bootstrap on a fresh host — read before prod deploy
└── README.md
```

## Quick start

```bash
cd infra/docker-compose
cp .env.example .env       # then edit values
```

### Dev (hot reload, exposes postgres/redis to host)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Services:

| Service     | URL                                |
|-------------|------------------------------------|
| api-gateway | `http://localhost:3000/graphql`    |
| web         | `http://localhost:3001`            |
| ai-service  | `http://localhost:8000`            |
| postgres    | `localhost:5432`                   |
| redis       | `localhost:6379`                   |

nginx/TLS are **not** part of the dev stack — dev talks to each service
directly on its published port. Reverse-proxy + certs only exist in prod.

### Prod (built images, restart policy, nginx is the sole public ingress)

Prod now includes `nginx` (reverse proxy + TLS termination) and `certbot`
(Let's Encrypt client). Before the **first** `up -d` on a fresh host you must
run the one-time cert bootstrap — see "First-time cert issuance" below. On
every subsequent boot (including `--build` after a code change) a plain
`up -d --build` is enough; `nginx` and `certbot` don't need re-bootstrapping
once a live certificate exists on the `certbot_certs` volume.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Services (all reached through nginx on 80/443 — see the port table below):

| Public URL                                | Routed to                                                                | Access                                   |
|-------------------------------------------|--------------------------------------------------------------------------|------------------------------------------|
| `https://$DOMAIN_NAME/graphql`            | `api-gateway:3000/graphql` (GraphQL, incl. subscriptions over WebSocket) | Open — JWT auth + rate limit (see below) |
| `https://$DOMAIN_NAME/graphiql`           | `api-gateway:3000/graphiql` (Mercurius GraphiQL UI)                      | Basic Auth **and** `GRAPHIQL_ENABLED=1`  |
| `https://$DOMAIN_NAME/` (everything else) | `web:3000` (Next.js dashboard)                                           | Basic Auth                               |

`/graphql` is deliberately the one un-gated route — the mobile client has no
way to send a second credential alongside its JWT. See "Public demo access"
below before exposing this host to the internet.

`api-gateway`, `web`, and `ai-service` no longer publish any host port in
prod — see "Ports" below for what changed and why.

### First-time cert issuance

Run this **once** per fresh host, after DNS is pointed at it and before
relying on the stack to serve real HTTPS traffic:

1. **Point DNS at the host.** Create an A record (and AAAA if the host has
   IPv6) for the domain you're deploying under, pointing at the host's
   public IP. Let's Encrypt's HTTP-01 challenge validates ownership by
   making an inbound HTTP request to this domain on port 80 — it must
   resolve and be reachable *before* you run the bootstrap script.
2. **Open ports 80 and 443** to the internet on the host's firewall / cloud
   security group. Both are required — 80 for the ACME challenge and the
   HTTP→HTTPS redirect, 443 for actual traffic.
3. **Fill in `.env`.** In `infra/docker-compose/.env` (copied from
   `.env.example`), set at minimum:
   ```bash
   DOMAIN_NAME=your-real-domain.example.com
   CERTBOT_EMAIL=you@example.com
   ```
   Leave `CERTBOT_STAGING=0` for a real deploy. Set it to `1` only if you
   want to dry-run the whole flow against Let's Encrypt's staging CA first
   (issues an untrusted-by-browsers cert but doesn't count against the
   production CA's per-domain rate limit — useful the first time you're
   unsure DNS/firewall are actually correct).
4. **Run the bootstrap script:**
   ```bash
   ./infra/scripts/init-letsencrypt.sh
   ```
   This creates a short-lived self-signed placeholder certificate (so nginx
   has *something* to bind port 443 with), starts `nginx`, deletes the
   placeholder, requests the real certificate from Let's Encrypt via the
   HTTP-01 webroot challenge (served by the now-running nginx), and reloads
   nginx to pick it up. It is safe to re-run — it no-ops if a certificate
   for `$DOMAIN_NAME` already exists (set `FORCE_RENEW=1` to force
   reissuance).
5. **Bring up the rest of the stack** (if you haven't already):
   ```bash
   cd infra/docker-compose
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
   From here on, renewal is automatic: the `certbot` service checks every
   12h and renews when the cert is within Let's Encrypt's renewal window;
   `nginx` reloads its own config/certs every 6h so a renewed cert is picked
   up without any manual step. See the `nginx` / `certbot` service comments
   in `docker-compose.prod.yml` for why reload is timer-based rather than
   certbot signaling nginx directly.

### Public demo access

Once the host is reachable from the internet, `/` and `/graphiql` are behind
HTTP Basic Auth ("the demo key") and `/graphql` is not. That split is
deliberate:

- **`/` (the dashboard) must be gated.** Its login form is credential-less by
  design — it's a team-internal tool (`web/CLAUDE.md`) — and its server actions
  connect directly to Postgres, Redis and S3. Un-gated on a public host it is a
  read-anything database inspector.
- **`/graphiql` must be gated**, and is additionally off unless
  `GRAPHIQL_ENABLED=1`: a schema explorer with mutation access to the live
  database is not something to serve by default.
- **`/graphql` cannot be gated.** The mobile client sends exactly
  `Content-Type` + `Authorization: Bearer <jwt>` (`client/src/services/api.ts`)
  with no hook for a second credential, and `Authorization` is already taken by
  the JWT — adding Basic Auth would break every installed app. It keeps its own
  JWT auth and login throttle, plus a per-IP `limit_req` in nginx
  (10 r/s, burst 40, returns a real `429`) as a flood guard.

So: **browser visitors get the key, phone testers get a demo account.**

1. **Create the credential file.** Required before first `up -d` on a public
   host — without it nginx still starts and `/graphql` still works, but the two
   gated routes return 500.

   ```bash
   docker run --rm httpd:2.4-alpine htpasswd -nbB demo 'YOUR_DEMO_KEY' \
     > infra/nginx/auth/.htpasswd
   ```

   `-B` selects bcrypt; `-n` prints to stdout instead of editing a file in the
   throwaway container. Add more users by appending more lines. The file is
   gitignored — only the directory (`.gitkeep`) is tracked. To rotate the key,
   regenerate the file; nginx picks it up within the 6h reload loop, or
   immediately with `docker compose exec nginx nginx -s reload`.

2. **Create the demo account.** There is no seed script — register once through
   the normal flow, either from the app or over `/graphql`:

   ```bash
   curl -s "https://$DOMAIN_NAME/graphql" \
     -H 'content-type: application/json' \
     -d '{"query":"mutation($i:RegisterInput!){register(input:$i){token}}","variables":{"i":{"firstname":"Demo","lastname":"User","phone":"0800000000","password":"CHANGE_ME"}}}'
   ```

   `phone` is the login identity (9–15 digits) and must be unique. The account
   gets `role=patient` by default, which is what a tester should have —
   `developer` cannot be self-registered. Treat the phone/password as a
   **published demo credential, not a secret**: anyone with the app can reach
   `/graphql` anyway, so the account's blast radius is what protects you, not
   its obscurity.

3. **Build the client against the domain.** No source change is needed —
   `client/src/services/endpoint.ts` honours `EXPO_PUBLIC_API_URL` verbatim
   before falling back to Expo's LAN-host derivation:

   ```bash
   EXPO_PUBLIC_API_URL=https://$DOMAIN_NAME/graphql pnpm --dir client android
   ```

   Note the value must include the `/graphql` path.

Registration stays open to anyone who finds `/graphql` — inherent to a public
demo, with the rate limit as the only mitigation. If that becomes a problem,
gate `register` in the gateway rather than in nginx.

### Other / custom environments

Create another override file (e.g. `docker-compose.staging.yml`) and chain it
the same way:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

## Ports

| Service     | Dev                | Prod                                         |
|-------------|--------------------|----------------------------------------------|
| nginx       | *(not run in dev)* | `80:80`, `443:443` — **sole public ingress** |
| api-gateway | `3000:3000`        | not published (reached via nginx `/graphql`) |
| web         | `3001:3000`        | not published (reached via nginx `/`)        |
| ai-service  | `8000:8000`        | **not published at all** — see below         |
| postgres    | `5432:5432`        | not published                                |
| redis       | `6379:6379`        | not published                                |

`ai-service` used to publish `8000:8000` directly to the host in prod; that
mapping is now removed entirely, and nginx does not proxy to it either.
Production traffic never needs to reach `ai-service` over HTTP:
api-gateway talks to it only over the Redis pub/sub channels
`analyze_bp_image` / `analyze_bp_image.reply`, and the web dashboard's
server-side `ai-service` health check
([`web/src/lib/ai-service.ts`](../web/src/lib/ai-service.ts)) calls
`http://ai-service:8000` over the internal `bp-net` network, which needs no
published host port. The removed mapping was a real internet-facing
exposure of an internal-only service with no auth in front of it — this is
a security tightening, not just a refactor side-effect of adding nginx.

## Env vars

All connection strings live in `.env`. `DATABASE_URL` is consumed by Prisma in
api-gateway; host **must** be `postgres` (the compose service name) inside the
compose network. Redis uses `REDIS_HOST=redis` for the same reason.

New in this change (prod only, consumed by `docker-compose.prod.yml` and
`infra/scripts/init-letsencrypt.sh`):

| Variable | Example | Description |
|---|---|---|
| `DOMAIN_NAME` | `bp-monitor.example.com` | Domain nginx terminates TLS for and certbot issues the certificate against. Must have a DNS A/AAAA record pointing at the host before first issuance. |
| `CERTBOT_EMAIL` | `admin@example.com` | Email Let's Encrypt sends expiry/problem notices to. |
| `CERTBOT_STAGING` | `0` | Set to `1` to issue from Let's Encrypt's staging CA while testing the bootstrap flow (untrusted cert, no rate-limit risk). Leave `0` for real deploys. |
| `GRAPHIQL_ENABLED` | `0` | Serves the Mercurius GraphiQL UI at `/graphiql` when `1`. Defaults to off in production only — outside production `graphiql` is on regardless, so dev is unaffected. Even at `1` the route stays behind Basic Auth. See "Public demo access". |

The Basic Auth credential file (`infra/nginx/auth/.htpasswd`) is **not** an env
var — it's a gitignored file mounted into the nginx container. See "Public
demo access" for how to generate and rotate it.

`web`'s `GATEWAY_URL` / `AI_SERVICE_URL` are now set directly in
`docker-compose.yml` (`http://api-gateway:3000` / `http://ai-service:8000`)
rather than left to their host-local defaults — those defaults
(`http://localhost:3000` / `:8000`, documented in `web/CLAUDE.md`) only make
sense when running `web` outside Docker; inside the `web` container
`localhost` resolves to the container itself, not to `api-gateway` /
`ai-service`. This was a pre-existing gap (the dashboard's ai-service health
check was silently unreachable in every dockerized environment) fixed in the
same change since it's directly load-bearing for `ai-service` losing its
public port — confirming the "web reaches ai-service over the internal
network" story above actually holds.

Never commit a real `.env` — only `.env.example` is tracked.

## Notes

- Each app owns its `Dockerfile` (multi-stage with `dev` + `prod` targets).
  Compose picks the target via the override files.
- The mobile **client** is intentionally absent from compose — run it with
  `pnpm --dir client start`.
- The `ai-service` container does **not** ship its OCR model weights
  (`*.onnx`, `templates.npz`) in the image. On first start
  `docker-entrypoint.sh` downloads them from `$AI_MODELS_R2_BASE_URL`
  into `/app/models` and verifies sha256 against
  `models/EXPECTED_HASHES.json`. The `ai_models` named volume persists
  the cache across container recreates so subsequent boots skip the
  download. Set `AI_MODELS_R2_BASE_URL` in `.env` before the first
  `docker compose up`; the placeholder value is rejected at start.
- **nginx config is a template, not a static file.** The official `nginx`
  image envsubst's every `/etc/nginx/templates/*.template` into
  `/etc/nginx/conf.d/` at container start, substituting only variables that
  are actually set in the container's environment — nginx's own runtime
  variables (`$host`, `$remote_addr`, `$http_upgrade`, ...) are not
  environment variables, so they pass through untouched. Only
  `${DOMAIN_NAME}` in `infra/nginx/templates/default.conf.template` gets
  replaced. See the comment at the top of that file for detail.
- **GraphQL subscriptions need the WebSocket upgrade.** Mercurius has
  `subscription: true`
  ([`server/app/api-gateway/src/app.module.ts`](../server/app/api-gateway/src/app.module.ts)),
  so the `/graphql` location block passes through `Upgrade` /
  `Connection` headers and raises `proxy_read_timeout` / `proxy_send_timeout`
  to 3600s so nginx doesn't cut long-lived subscription connections.
- **Single domain, path-based routing** — the dashboard and the GraphQL API
  share one `DOMAIN_NAME` and one certificate (`/graphql` + `/graphiql` →
  api-gateway, everything else → web) rather than separate subdomains. This
  is the simpler bootstrap for a greenfield deploy with no DNS split yet;
  revisit with a SAN cert (or two certs) across `$DOMAIN_NAME` +
  `api.$DOMAIN_NAME` if the gateway and dashboard ever need independent
  scaling, rate limiting, or WAF policy.
- **GraphiQL is proxied for parity, not because it's newly exposed.**
  `app.module.ts` sets `graphiql: true` unconditionally (not gated behind
  `NODE_ENV`), so it was already internet-reachable at `:3000/graphiql`
  before nginx existed (the gateway published its port directly). Proxying
  `/graphiql` through nginx doesn't create a new exposure, it just moves an
  existing one behind TLS. Gating GraphiQL off in production is an
  api-gateway app-code change, out of scope here — flagged for a future
  `nest-dev` task, not fixed in this change.
- **certbot's image tag is deliberately not pinned**, unlike this project's
  own Dockerfiles. It needs to track Let's Encrypt's ACME protocol over
  however many years the host stays up; a stale pin is a known way for
  renewals to silently start failing. Bump it by hand
  (`docker compose pull certbot`) as routine maintenance.
- **nginx reloads on a timer, not on a certbot signal.** Wiring certbot to
  signal nginx directly on renewal would mean mounting the host's
  `docker.sock` into one of the containers, handing it control over the
  whole Docker daemon just to reload a config file. Instead `nginx` runs
  [`reload-loop.sh`](./nginx/reload-loop.sh), reloading every 6h
  unconditionally — cheap and connection-preserving when nothing changed,
  and within 6h of any renewal by `certbot`'s
  [`renew-loop.sh`](./certbot/renew-loop.sh) (checks every 12h).
- **No app code changed for reverse-proxy compatibility.** Neither
  `api-gateway` nor `web` currently inspect `req.ip` / `X-Forwarded-*` /
  proxy trust settings (verified by grep before making this change), so no
  `trustProxy` / `trustHost` config was needed on either side. nginx still
  sets the standard `X-Real-IP` / `X-Forwarded-For` / `X-Forwarded-Proto` /
  `X-Forwarded-Host` headers for whichever side picks this up later — if
  IP-based logic (stricter rate limiting, geo rules, audit logging) is
  added to api-gateway in the future, `main.ts` will need
  `new FastifyAdapter({ trustProxy: true })` for `req.ip` to reflect the
  real client instead of nginx's container IP; that's an api-gateway
  app-code change for `nest-dev` when the need arises, not done here.
