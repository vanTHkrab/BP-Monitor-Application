---
title: Deploying the backend stack
description: The production Compose stack, first-time certificate issuance, and the access model that keeps the dashboard off the public internet.
status: current
updated: 2026-08-06
owner: cross
---

# Deploying the backend stack

Covers `api-gateway`, `ai-service`, `web`, Postgres, Redis, nginx, and certbot
via Docker Compose. The mobile client is not containerised — it ships through
Expo.

Full option reference, port tables, and the reasoning behind each service's
configuration live in [`infra/README.md`](../../infra/README.md). This guide is
the sequence.

## What prod adds over dev

| | Dev | Prod |
| --- | --- | --- |
| Ingress | Each service publishes its own host port | **nginx only**, on 80/443 |
| TLS | None | Let's Encrypt via certbot, auto-renewing |
| api-gateway | `3000:3000` | Not published — reached at `/graphql` |
| web | `3001:3000` | Not published — reached at `/` |
| ai-service | `8000:8000` | **Not published at all**, and not proxied |
| postgres / redis | Published | Not published |

`ai-service` publishing port 8000 was a real internet-facing exposure of an
unauthenticated internal service. It reaches the gateway over Redis pub/sub
and the dashboard over the internal `bp-net` network, so it needs no host
port at all.

## First deploy on a fresh host

Steps 1–3 must happen before the first `up -d`. Let's Encrypt validates
ownership with an inbound HTTP request, so DNS and the firewall must already
be right.

**1. Point DNS at the host.** An A record (and AAAA if the host has IPv6) for
your domain, resolving to the host's public IP.

**2. Open ports 80 and 443.** Both — 80 for the ACME challenge and the
HTTP→HTTPS redirect, 443 for traffic.

**3. Fill in `.env`.**

```bash
cd infra/docker-compose
cp .env.example .env
```

At minimum:

```bash
DOMAIN_NAME=bp-monitor.example.com
CERTBOT_EMAIL=you@example.com
CERTBOT_STAGING=0        # 1 dry-runs against the staging CA: untrusted cert, no rate-limit risk
GRAPHIQL_ENABLED=0       # 1 serves GraphiQL at /graphiql (still behind Basic Auth)
```

`DATABASE_URL`'s host must be `postgres` and Redis's must be `redis` — the
Compose service names. `localhost` inside a container is that container.

**4. Create the Basic Auth credential.** Required before the first `up -d` on
a public host: without it nginx starts and `/graphql` works, but the two gated
routes return 500.

```bash
docker run --rm httpd:2.4-alpine htpasswd -nbB demo 'YOUR_DEMO_KEY' \
  > infra/nginx/auth/.htpasswd
```

`-B` selects bcrypt, `-n` prints to stdout. The file is gitignored; only the
directory is tracked. Rotating it is regenerating it — nginx picks it up
within its 6h reload loop, or immediately with
`docker compose exec nginx nginx -s reload`.

**5. Issue the certificate.** Once per host.

```bash
./infra/scripts/init-letsencrypt.sh
```

Creates a self-signed placeholder so nginx can bind 443, starts nginx, deletes
the placeholder, requests the real certificate over the HTTP-01 webroot
challenge, and reloads. Safe to re-run — it no-ops if a certificate already
exists (`FORCE_RENEW=1` overrides).

**6. Bring up the stack.**

```bash
cd infra/docker-compose
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Subsequent deploys

Just step 6. nginx and certbot need no re-bootstrapping once a live
certificate exists on the `certbot_certs` volume.

Renewal is automatic and timer-based: certbot checks every 12h, nginx reloads
every 6h. certbot does not signal nginx directly because that would mean
mounting the host's `docker.sock` into a container — handing it the whole
Docker daemon to reload a config file.

## The access model

| Route | Goes to | Gate |
| --- | --- | --- |
| `https://$DOMAIN_NAME/graphql` | api-gateway | **None** — JWT auth + nginx rate limit only |
| `https://$DOMAIN_NAME/graphiql` | api-gateway | Basic Auth **and** `GRAPHIQL_ENABLED=1` |
| `https://$DOMAIN_NAME/admin/*` | web — service status | Basic Auth |
| `https://$DOMAIN_NAME/` | web — documentation | **None** — deliberately public |

The split is deliberate:

- **The status pages must be gated.** `web/` has no authentication at all — no
  auth library is installed — while the pages under `/admin/` connect straight
  to Postgres, Redis, and S3 and render session counts and user totals.
  Ungated on a public host they are a read-anything database inspector. The
  Basic Auth credential is the only thing in front of them.
- **The docs are not gated, on purpose.** `/` serves the project documentation,
  prerendered from `docs/**/*.md` at build time. It is static HTML with no
  credentials, no patient data, and no datastore reads, so a password there
  would only guard the thing the site exists to publish.
- **The prefix is what makes this expressible.** nginx matches the longest
  prefix, so `/admin/` must stay above `location /` in
  `infra/nginx/templates/default.conf.template`. Removing that block does not
  fail loudly — it silently publishes the status pages. If a future page under
  `/` starts reading a datastore, move it under `/admin/` rather than adding a
  second gate.
- **GraphiQL must be gated** and is additionally off by default in production.
  A schema explorer with mutation access to live patient data is not something
  to serve casually. The env gate and the Basic Auth gate fail differently —
  neither is redundant.
- **`/graphql` cannot be gated.** The mobile client sends `Content-Type` and
  `Authorization: Bearer <jwt>` with no hook for a second credential, and
  `Authorization` is already taken. Adding Basic Auth would break every
  installed app. It keeps its own auth, its own throttle, and a per-IP
  `limit_req` in nginx (10 r/s, burst 40, real `429`) as a flood guard.

So: browser visitors get the Basic Auth key, phone testers get a demo account.

> ⚠️ Registration stays open to anyone who reaches `/graphql` — inherent to a
> public demo, with the rate limit as the only mitigation. If that becomes a
> problem, gate `register` in the gateway, not in nginx.

## Creating a demo account

There is no seed script. Register through the normal flow:

```bash
curl -s "https://$DOMAIN_NAME/graphql" \
  -H 'content-type: application/json' \
  -d '{"query":"mutation($i:RegisterInput!){register(input:$i){token}}","variables":{"i":{"firstname":"Demo","lastname":"User","phone":"0800000000","password":"CHANGE_ME"}}}'
```

`phone` is the login identity (9–15 digits, unique). The account gets
`role=patient`; `developer` cannot be self-registered. Treat the credential as
published, not secret — the account's blast radius is what protects you.

## Building the client against the deployed host

No source change needed:

```bash
EXPO_PUBLIC_API_URL=https://bp-monitor.example.com/graphql pnpm --dir client android
```

The value must include the `/graphql` path.

## Model weights on first container start

The `ai-service` image does not ship `*.onnx` or `templates.npz`.
`docker-entrypoint.sh` downloads them from `$AI_MODELS_R2_BASE_URL` into
`/app/models` and verifies sha256 against `models/EXPECTED_HASHES.json`. The
`ai_models` named volume persists them across recreates, so only the first
boot pays the ~62 MB.

Set `AI_MODELS_R2_BASE_URL` before the first `up` — the placeholder is
rejected at start. Rationale: [ADR-005](../decisions/ADR-005-model-weights-from-r2.md).

## Other environments

Chain another override the same way:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

Never commit a real `.env`. Only `.env.example` is tracked.
