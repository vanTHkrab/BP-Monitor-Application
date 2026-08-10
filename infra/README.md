# infra

Infrastructure assets for running the BP Monitor backend + web.

The mobile **client** is **not** containerised — it runs on Expo directly.

## Two runtimes — this file covers the Compose one

| | Podman Quadlet on EC2 | Docker Compose |
| --- | --- | --- |
| Status | **Production** | **Development** (and prod-parity staging) |
| Reference | [podman/README.md](./podman/README.md) | **this file** |
| Postgres | Supabase, hosted off-box | `postgres` container |

> ⚠️ **Production runs on Podman Quadlet, not on Docker Compose.** If you are
> deploying to the internet, you want [`infra/podman/`](./podman/) and
> [docs/guides/deploy.md](../docs/guides/deploy.md), not this file. Everything
> below still works and is still maintained — it is the development stack, and
> `docker-compose.prod.yml` is now the cheapest way to exercise the nginx access
> model without an EC2 host, rather than the thing that serves real traffic.
>
> Three consequences worth internalising before reading on: the `postgres`
> service described below is the **development** database — production Postgres
> is hosted on Supabase and appears nowhere in these files; where this file says
> "prod", read "prod-shaped"; and the `web` dashboard is **development only**,
> defined in `docker-compose.dev.yml` and deliberately absent from the base file
> so it cannot start in a prod-shaped stack.

With that established, the rest of this file is the Compose reference.

> **Note:** the step-by-step deploy sequence for both runtimes lives in
> [docs/guides/deploy.md](../docs/guides/deploy.md), and first-time local
> setup in [docs/guides/setup.md](../docs/guides/setup.md). **This file
> remains the reference** for Compose file structure, the port tables, and
> the reasoning behind each service's configuration — the guides link here
> rather than duplicating it.

## Layout

```text
infra/
├── podman/                         # PRODUCTION runtime — Quadlet units for a
│   │                               # single EC2 host. See podman/README.md.
│   ├── quadlet/                    # .container / .network / .volume / .target
│   ├── systemd/bp-migrate.service  # manual-gate Prisma migrations (Supabase)
│   ├── scripts/                    # install, build, redeploy
│   └── bp-monitor.env.example
├── docker-compose/
│   ├── docker-compose.yml          # base services: postgres, redis, api-gateway, ai-service
│   ├── docker-compose.dev.yml      # override: hot-reload, volume mounts, exposed DB ports, + web
│   ├── docker-compose.prod.yml     # override: build target=prod, restart policy, nginx + cloudflared
│   └── .env.example                # copy to .env, fill in real values
├── nginx/
│   ├── templates/
│   │   └── default.conf.template   # envsubst'd into /etc/nginx/conf.d/default.conf at container start
│   ├── auth/                       # Basic Auth credentials for /graphiql — .htpasswd is gitignored
│   └── reload-loop.sh              # nginx entrypoint override — periodic reload so upstreams re-resolve
└── README.md
```

`certbot/` and `scripts/init-letsencrypt.sh` are gone. TLS terminates at
Cloudflare's edge and the tunnel dials out, so there is no ACME challenge to
serve and no inbound port 80 to serve it on.

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

### Prod-shaped (built images, restart policy, tunnel ingress)

> This override is **prod-parity staging**, not the production runtime — see the
> banner at the top of this file. It is what you run to exercise nginx and the
> access model on a throwaway host. Real production is
> [`infra/podman/`](./podman/), where Postgres is Supabase rather than the
> container this stack starts.

This override adds `nginx` (router and access gate) and `cloudflared` (the
Cloudflare Tunnel connector). There is **no certbot and no bootstrap step**: TLS
terminates at Cloudflare's edge, so nginx serves plain HTTP on the internal
network and starts on a bare host with nothing to pre-provision.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Leave `TUNNEL_TOKEN` **empty** unless you mean it — a real token publishes your
laptop on a real hostname. Without one, `cloudflared` will fail to register and
everything else still comes up; exercise nginx from inside the network:

```bash
docker compose exec nginx wget -qO- 'http://127.0.0.1/graphql?query=%7Bhello%7D'
```

Routes (all reached through nginx, which nothing but `cloudflared` can reach):

| Public URL | Routed to | Access |
| --- | --- | --- |
| `https://$DOMAIN_NAME/graphql` | `api-gateway:3000/graphql` (incl. subscriptions over WebSocket) | Open — JWT auth + rate limit |
| `https://$DOMAIN_NAME/graphiql` | `api-gateway:3000/graphiql` | Basic Auth **and** `GRAPHIQL_ENABLED` on |
| `https://$DOMAIN_NAME/api/auth/*` | `api-gateway:3000` — Better Auth's own routes | Open; throttled per credential |
| `https://$DOMAIN_NAME/.well-known/assetlinks.json` | `api-gateway:3000` — Digital Asset Links | Open, and must stay open |
| everything else | `api-gateway:3000` | Open |

The catch-all points at the **gateway**, and that is load-bearing rather than a
fallback. It used to point at the `web` dashboard, which meant `/api/auth/*` and
`/.well-known/assetlinks.json` — real gateway routes with no `location` of their
own — returned a Next.js 404. Email-OTP verification was broken and Android
could never accept a passkey. If you add a location above the catch-all, do not
shrink what the catch-all reaches.

`/graphql` is deliberately the one route that cannot be gated — the mobile
client has no way to send a second credential alongside its JWT. See "Public
demo access" below.

### The tunnel

Routing is **not** in this repo. The connector authenticates with a token and
Cloudflare tells it where to send traffic; the mapping lives in the dashboard
under Zero Trust → Networks → Tunnels → *your tunnel* → **Public Hostname**, and
must read:

| Field | Value |
| --- | --- |
| Subdomain | `api` |
| Domain | your zone |
| Type | `HTTP` |
| URL | `nginx:80` |

> ⚠️ **Point it at `nginx`, never at `api-gateway`.** nginx owns the
> `/graphiql` Basic Auth gate and the per-IP flood guard on `/graphql`. A
> hostname wired straight to the gateway works, removes both, and reports
> nothing.

That a dashboard row can silently repoint or delete your ingress is the real
cost of this design. `DOMAIN_NAME` is the repo's only claim about what the stack
answers to; keep the two in step by hand.

### Why the per-IP rate limit needs `real_ip`

Behind a tunnel every request reaches nginx from the `cloudflared` container's
address. Without `set_real_ip_from` + `real_ip_header CF-Connecting-IP` in the
template, `$binary_remote_addr` is a single value for the entire internet: all
users share one 10 r/s budget and one flooder 429s everybody. The limit still
"works" — it just keys on the wrong thing, and nothing logs that it does. This
is the one change that a move to any reverse proxy silently breaks.

### Public demo access

Once the host is reachable from the internet, `/graphiql` is behind HTTP Basic
Auth ("the demo key") and everything else is not. That split is deliberate:

- **The dashboard is not on this host at all.** `/` used to serve `web`, gated
  by a Basic Auth rule here. `web` is no longer deployed — it has no
  authentication of its own and its `/admin/` pages are a read-anything
  database inspector, so it was removed from the deploy rather than left
  depending on one nginx block that fails silently when deleted. `/` now
  reaches the gateway.
- **`/graphiql` must be gated**, and is additionally off unless
  `GRAPHIQL_ENABLED` is `1`, `true`, `yes`, or `on`: a schema explorer with
  mutation access to the live database is not something to serve by default.
  Any other value — including an unrecognised one — leaves it off.
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

| Service     | Dev                | Prod-shaped                                    |
|-------------|--------------------|------------------------------------------------|
| cloudflared | *(not run in dev)* | no port — dials **out** to Cloudflare          |
| nginx       | *(not run in dev)* | no port — reached by cloudflared over `bp-net`  |
| api-gateway | `3000:3000`        | not published (reached via nginx)              |
| web         | `3001:3000`        | **not run** — dev stack only                   |
| ai-service  | `8000:8000`        | **not published at all** — see below           |
| postgres    | `5432:5432`        | not published                                  |
| redis       | `6379:6379`        | not published                                  |

The prod-shaped column has no host ports in it at all, and that is the point of
the tunnel: on the real EC2 host the inbound security group is empty. Compare
with the previous design, where nginx published `80:80` and `443:443` and
rootless Podman additionally needed the host sysctl
`net.ipv4.ip_unprivileged_port_start=80` to bind them.

`ai-service` used to publish `8000:8000` directly to the host; that mapping is
removed entirely, and nginx does not proxy to it either. Production traffic
never needs to reach it over HTTP — api-gateway talks to it only over the Redis
pub/sub channels `analyze_bp_image` / `analyze_bp_image.reply`. Its second
consumer, the dashboard's `/health` probe
([`web/src/lib/ai-service.ts`](../web/src/lib/ai-service.ts)), went away with
the dashboard. The removed mapping was a real internet-facing exposure of an
internal-only service with no auth in front of it.

## Env vars

All connection strings live in `.env`. `DATABASE_URL` is consumed by Prisma in
api-gateway; host **must** be `postgres` (the compose service name) inside the
compose network. The gateway reaches Redis with `REDIS_HOST=redis` for the
same reason; `ai-service` needs `REDIS_URL=redis://redis:6379` instead, because
`main.py` reads only that variable.

Prod-shaped only, consumed by `docker-compose.prod.yml`:

| Variable | Example | Description |
|---|---|---|
| `DOMAIN_NAME` | `api.example.com` | nginx's `server_name`. The block is `default_server`, so a mismatch does not 404 — what actually routes traffic is the tunnel's Public Hostname. **No DNS record of your own is needed**; Cloudflare creates the CNAME. |
| `TUNNEL_TOKEN` | *(empty)* | The Cloudflare Tunnel credential. On its own it is enough to publish traffic into this stack's network, so in production it is a Podman secret and never a file. Leave it empty when rehearsing locally. |
| `GRAPHIQL_ENABLED` | `0` | Serves the Mercurius GraphiQL UI at `/graphiql` when set to `1`, `true`, `yes`, or `on` (case-insensitive, trimmed). Every other non-empty value is off, including unrecognised ones — a typo cannot accidentally open it. Empty or unset defaults to off in production only; outside production `graphiql` is on regardless, so dev is unaffected. Even when on, the route stays behind Basic Auth. |

Forwarded to the gateway in **both** stacks since 2026-08-09, and not before:
`BETTER_AUTH_URL` (required — origin only; unset, every `/api/auth` route 404s,
including the mobile app's email-OTP calls), `BETTER_AUTH_SECRET`, `PASSKEY_*`,
`GOOGLE_*`, `ANDROID_APP_*`, `EXPO_ACCESS_TOKEN`, `HAVE_I_BEEN_PWNED_ENABLED`.
Each degrades silently rather than failing at boot, which is exactly why they
went unwired for so long. See
[docs/reference/environment-variables.md](../docs/reference/environment-variables.md).

`CERTBOT_EMAIL` and `CERTBOT_STAGING` are **removed** — there is no certbot.

The Basic Auth credential file (`infra/nginx/auth/.htpasswd`) is **not** an env
var — it's a gitignored file mounted into the nginx container. See "Public
demo access" for how to generate and rotate it.

`web` is wired in `docker-compose.dev.yml` only, and gets `GATEWAY_URL`,
`AI_SERVICE_URL`, `DATABASE_URL`, `REDIS_HOST` and the `S3_*` block pointed at
the Compose services. The host-local defaults those clients fall back to
(`http://localhost:3000`, `:8000`, and a `localhost` Redis) only make sense
outside Docker — inside the container `localhost` is the container itself.
Before this change only the first two were set, so every `/admin/` page except
the gateway probe reported its service as down, with nothing in a log to say the
client had simply never been pointed anywhere.

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
- **One host, one upstream** — `DOMAIN_NAME` is an API host (`api.example.com`)
  and every route on it reaches api-gateway. This used to be a split between
  the gateway and the dashboard on a shared domain and one certificate; the
  dashboard is no longer deployed, and TLS is Cloudflare's, so both halves of
  that trade-off are gone. Adding a second hostname is now a dashboard row plus
  a `location` block, not a certificate change.
- **GraphiQL now has two independent gates.** `app.module.ts` resolves
  `graphiql` from `GRAPHIQL_ENABLED` (`1`/`true`/`yes`/`on` = on, any other
  non-empty value = off, empty or unset defers to `NODE_ENV`), defaulting to
  on everywhere except `NODE_ENV=production` — so a prod deploy does not serve
  a mutation-capable schema explorer unless someone opts in. The accepted set
  is closed rather than a truthiness test, so `GRAPHIQL_ENABLED=false` is off
  rather than on. nginx puts
  `/graphiql` behind Basic Auth on top of that. Neither gate is redundant;
  they fail differently. (This note previously said `graphiql: true` was set
  unconditionally and that gating it was future `nest-dev` work — that work
  has since landed.)
- **cloudflared's image tag is deliberately not pinned**, unlike this project's
  own Dockerfiles — the same reasoning certbot's tag used to carry. The
  connector speaks a protocol Cloudflare evolves, and a stale pin is a known
  way for a tunnel to start failing. `--no-autoupdate` is set because an
  in-place binary swap inside a container is pointless (the layer is read-only,
  a restart reverts it) and fights `restart: unless-stopped`. Update by pulling
  a new image as routine maintenance.
- **nginx still reloads on a timer**, though not for the reason it used to.
  [`reload-loop.sh`](./nginx/reload-loop.sh) existed so a certbot renewal was
  picked up without certbot needing to signal the container. There is no
  certbot now, but nginx resolves `proxy_pass http://api-gateway:3000` **once,
  at config load** — a recreated gateway on a new address means every request
  502s until something makes it re-resolve. The 6h reload is the backstop for
  recreates nobody triggered on purpose; after a deliberate redeploy, restart
  nginx instead of waiting.
- **No app code changed for proxy compatibility.** `api-gateway` does not
  inspect `req.ip` / `X-Forwarded-*` / proxy trust settings, so no `trustProxy`
  config was needed. nginx sets `X-Real-IP` / `X-Forwarded-For` /
  `X-Forwarded-Host` for whichever side picks this up later. If IP-based logic
  (stricter rate limiting, geo rules, audit logging) is ever added,
  `main.ts` needs `new FastifyAdapter({ trustProxy: true })` for `req.ip` to
  reflect the real client — and behind the tunnel there are now **two** hops to
  unwind, Cloudflare's and nginx's. That is an api-gateway change for
  `nest-dev` when the need arises, not done here.
- **`X-Forwarded-Proto` is hardcoded to `https`, not `$scheme`.** `$scheme` is
  `http` on the nginx hop and always will be, because TLS ends at Cloudflare.
  Passing `http` upstream makes the gateway build `http://` URLs for a site
  that is `https://` to every real client, which surfaces as Better Auth
  redirects and callback URLs quietly dropping to plain HTTP.
