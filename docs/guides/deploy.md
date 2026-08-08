---
title: Deploying the backend stack
description: The two runtimes — Podman Quadlet on EC2 for production, Docker Compose for development — plus certificate issuance, the access model, and the Supabase database split.
status: current
updated: 2026-08-09
owner: cross
---

# Deploying the backend stack

Covers `api-gateway`, `ai-service`, `web`, Redis, nginx, and certbot. The mobile
client is not containerised — it ships through Expo.

## Which runtime am I on?

There are **two**, and they are not variants of each other. Pick by what you are
doing, not by which one you have used before.

| | **Podman Quadlet on EC2** | **Docker Compose** |
| --- | --- | --- |
| Status | **Production** | **Development** |
| Files | [`infra/podman/`](../../infra/podman/) | [`infra/docker-compose/`](../../infra/docker-compose/) |
| Supervisor | systemd (user manager) | `docker compose` |
| Postgres | **Supabase, hosted off-box** | `postgres` container |
| Redis | container + volume | container + volume |
| Logs | `journalctl --user -u bp-*` | `docker compose logs` |
| Migrations | manual `bp-migrate.service` | run by hand |
| Reference | [`infra/podman/README.md`](../../infra/podman/README.md) | [`infra/README.md`](../../infra/README.md) |

If you are deploying to the internet, you want the Podman path. If you are
running the stack on your laptop, you want Compose. Nothing about the Compose
stack changed when the Podman runtime was added — it is still the development
story and is not going away.

Two things are shared by both and documented once, at the bottom of this file:
[the access model](#the-access-model) (what nginx gates and why) and
[model weights on first start](#model-weights-on-first-container-start).

---

## Production — Podman Quadlet on a single EC2 host

Full reference, every decision with its trade-off, and the list of things that
have not been verified: [`infra/podman/README.md`](../../infra/podman/README.md).
Read that before your first deploy. This is the sequence.

> ⚠️ This runtime has never been run end to end. The unit files are a reviewed
> design, not a proven deploy. Expect to debug the first boot, and use the smoke
> checks at the end rather than trusting `systemctl status`.

### Before you touch the host

**1. Create the Supabase project.** Production Postgres is hosted; there is no
`postgres` container in this runtime. Collect two connection strings:

- **Pooled, transaction mode, port 6543** — for `api-gateway` and `web`.
- **Direct or session pooler, port 5432** — for migrations only.

They are not interchangeable. Migrations need session-scoped state (an advisory
lock, DDL in a transaction) that a transaction-mode pooler cannot hold. Runtime
traffic on the direct endpoint burns the connection ceiling — and this stack has
two Postgres clients, because the dashboard's `/admin/` pages open their own pool
straight at the database rather than going through the gateway.

Append `sslmode=require` to both: the connection now leaves the host.

> ⚠️ Supabase's direct hostname is IPv6-only for projects without the IPv4
> add-on. On an IPv4-only EC2 subnet it is simply unreachable, and the failure
> looks like DNS. Use the **session-mode** pooler on 5432 for migrations in that
> case. Check with `getent hosts` before assuming.

**2. Launch the instance.** t3.medium (4 GiB) recommended, ≥ 20 GiB disk. The
resource ceilings across the six units total ~3.8 GiB, and images are built on
the box — a t3.small will run the stack but leaves nothing for a build. Allocate
an Elastic IP.

**3. Security group.**

- Inbound: **tcp/80 and tcp/443 from `0.0.0.0/0`, and nothing else.** Port 80 is
  not optional — it carries the ACME challenge, for first issuance and for every
  renewal. Prefer SSM Session Manager over an inbound SSH rule.
- Outbound: tcp/6543 and tcp/5432 to Supabase, tcp/443 for R2 model artifacts,
  the S3 endpoint, Let's Encrypt and image registries, plus DNS. The full table
  is in the Podman README.

**4. DNS.** An A record (AAAA too if the instance has IPv6) for your domain
pointing at the Elastic IP, resolving *before* you request a certificate.

### Host setup

```bash
# 5. Podman and git. Confirm the version — these units were written for 5.x.
sudo dnf install -y podman git     # Amazon Linux 2023 / RHEL family
podman --version

# 6. Keep the user manager alive after logout. WITHOUT THIS, the entire stack
#    stops the moment your SSH session ends.
sudo loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger        # expect Linger=yes

# 7. Let a rootless nginx bind 80/443.
echo 'net.ipv4.ip_unprivileged_port_start=80' \
  | sudo tee /etc/sysctl.d/99-bp-monitor-ports.conf
sudo sysctl --system
sysctl net.ipv4.ip_unprivileged_port_start   # expect 80

# 8. Clone to /opt/bp-monitor — the unit files hard-code this path.
sudo install -d -o "$USER" -g "$USER" /opt/bp-monitor
git clone <repo-url> /opt/bp-monitor
cd /opt/bp-monitor
```

Everything from here runs as the **deploy user**, never as root. `install.sh`
refuses to run as root, because rootful changes the port story, the SELinux
flags and the linger requirement all at once.

### Configuration and secrets

```bash
# 9. Non-secret configuration.
sudo install -d -m 0755 -o "$USER" -g "$USER" /etc/bp-monitor
install -m 0640 infra/podman/bp-monitor.env.example /etc/bp-monitor/bp-monitor.env
$EDITOR /etc/bp-monitor/bp-monitor.env     # DOMAIN_NAME, CERTBOT_EMAIL,
                                           # AI_MODELS_R2_BASE_URL, S3_*
```

```bash
# 10. Secrets — five of them, piped so no value lands in shell history.
printf '%s' 'postgresql://USER:PASS@REGION.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1' \
  | podman secret create bp-database-url -
printf '%s' 'postgresql://USER:PASS@REGION.pooler.supabase.com:5432/postgres?sslmode=require' \
  | podman secret create bp-database-url-direct -
printf '%s' '<long random string, 32+ chars>' | podman secret create bp-jwt-secret -
printf '%s' '<S3 access key id>'              | podman secret create bp-s3-access-key-id -
printf '%s' '<S3 secret access key>'          | podman secret create bp-s3-secret-access-key -

podman secret ls
```

```bash
# 11. Basic Auth credential for /admin/ and /graphiql. Gitignored; the
#     directory is tracked, the file is not.
podman run --rm docker.io/library/httpd:2.4-alpine \
  htpasswd -nbB demo 'YOUR_DEMO_KEY' > infra/nginx/auth/.htpasswd
```

### Install, build, certificate, start

```bash
# 12. Install the Quadlet units into your user systemd.
./infra/podman/scripts/install.sh
systemctl --user list-unit-files 'bp-*'      # must not be empty

# 13. Build the three images on the host (git SHA + latest).
./infra/podman/scripts/build-images.sh
# Then set BP_IMAGE_TAG in /etc/bp-monitor/bp-monitor.env to the SHA it printed.
```

```bash
# 14. Migrations — BEFORE starting the gateway that expects the new schema.
systemctl --user start bp-migrate.service
journalctl --user -u bp-migrate.service -n 100 --no-pager
```

`bp-migrate.service` is `Type=oneshot`, so `start` blocks and a failure leaves
the unit in `systemctl --user --failed`. It is deliberately **not** part of
`bp-monitor.target`: the gateway has `Restart=always`, and migrate-on-boot would
turn a crash loop into repeated schema mutations against the production
database. It injects `bp-database-url-direct` over the `DATABASE_URL` variable
name, which is why no application change was needed.

```bash
# 15. First certificate. Once per host. DNS and the security group must
#     already be right — Let's Encrypt validates by inbound HTTP on port 80.
./infra/podman/scripts/init-letsencrypt.sh
```

Set `CERTBOT_STAGING=1` first if you want to prove DNS and the firewall without
burning the production CA's per-domain rate limit, then re-run with `0`.

```bash
# 16. Up, and enable at boot.
systemctl --user start bp-monitor.target
systemctl --user enable bp-monitor.target
systemctl --user list-units 'bp-*'
```

### Smoke-check — from outside the host

A check run on the box proves less: it skips DNS, the security group, and TLS as
a client sees it.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://$DOMAIN_NAME/          # 200, docs
curl -sS -o /dev/null -w '%{http_code}\n' https://$DOMAIN_NAME/admin/    # 401, gated
curl -sS https://$DOMAIN_NAME/graphql \
  -H 'content-type: application/json' -d '{"query":"{hello}"}'           # a GraphQL reply
```

On the host, confirm ai-service finished its model download and Redis is
reachable:

```bash
podman healthcheck run ai-service && echo ok
journalctl --user -u bp-ai-service.service -n 40 --no-pager   # "models: ... ok"
```

### Subsequent deploys

```bash
git -C /opt/bp-monitor pull
# If this deploy ships a Prisma migration, run it first — additive schema, then
# code. There is no down-migration.
systemctl --user start bp-migrate.service
./infra/podman/scripts/redeploy.sh
```

`redeploy.sh` rebuilds, restarts the app units, and **restarts nginx last**.
That last step is not cosmetic: nginx resolves `proxy_pass http://api-gateway:3000`
once, at config load, so a recreated gateway on a new address means every
request 502s until nginx re-resolves. The 6h reload loop eventually fixes it;
the restart fixes it now.

### Rolling back

Images carry the git SHA as well as `latest`, so a rollback is a retag and a
restart — no rebuild:

```bash
podman tag localhost/bp-monitor/api-gateway:<old-sha> localhost/bp-monitor/api-gateway:latest
podman tag localhost/bp-monitor/web:<old-sha>         localhost/bp-monitor/web:latest
podman tag localhost/bp-monitor/ai-service:<old-sha>  localhost/bp-monitor/ai-service:latest
systemctl --user restart bp-api-gateway bp-ai-service bp-web bp-nginx
```

A schema migration is **not** rolled back by this, which is why the ordering rule
is additive schema first, code second, and any column drop in a later separate
change. "Roll back the code" must always be safe against the new schema.

### Everyday operations

```bash
systemctl --user start|stop|restart bp-monitor.target
systemctl --user --failed
journalctl --user -u bp-api-gateway.service -f
journalctl --user -u 'bp-*' --since today
podman ps
podman stats --no-stream
```

---

## Development — Docker Compose

Unchanged. Full option reference, port tables, and per-service reasoning:
[`infra/README.md`](../../infra/README.md).

This stack includes a `postgres` container — it is the *development* database.
Production Postgres is Supabase and lives nowhere in these files.

```bash
cd infra/docker-compose
cp .env.example .env       # then edit
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

`DATABASE_URL`'s host must be `postgres` and Redis's must be `redis` — the
Compose service names. `localhost` inside a container is that container.

The prod-shaped Compose stack (`docker-compose.prod.yml`, with nginx and
certbot) still exists and still works. It is now a **staging / prod-parity**
tool rather than the production runtime: it is the cheapest way to exercise the
nginx access model and the certificate bootstrap without an EC2 host. Its
sequence — DNS, ports 80/443, `.env`, `.htpasswd`,
`./infra/scripts/init-letsencrypt.sh`, then
`docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` —
is documented in [`infra/README.md`](../../infra/README.md).

---

## Shared by both runtimes

### The access model

nginx serves the same config in both runtimes
([`infra/nginx/templates/default.conf.template`](../../infra/nginx/templates/default.conf.template)),
so this is identical on Compose and Podman.

| Route | Goes to | Gate |
| --- | --- | --- |
| `https://$DOMAIN_NAME/graphql` | api-gateway | **None** — JWT auth + nginx rate limit only |
| `https://$DOMAIN_NAME/graphiql` | api-gateway | Basic Auth **and** `GRAPHIQL_ENABLED` set to `1`/`true`/`yes`/`on` |
| `https://$DOMAIN_NAME/admin/*` | web — service status | Basic Auth |
| `https://$DOMAIN_NAME/` | web — documentation | **None** — deliberately public |

The split is deliberate:

- **The status pages must be gated.** `web/` has no authentication at all — no
  auth library is installed — while the pages under `/admin/` connect straight
  to Postgres, Redis, and S3 and render session counts and user totals. Ungated
  on a public host they are a read-anything database inspector. The Basic Auth
  credential is the only thing in front of them.
- **The docs are not gated, on purpose.** `/` serves the project documentation,
  prerendered from `docs/**/*.md` at build time. It is static HTML with no
  credentials, no patient data, and no datastore reads, so a password there
  would only guard the thing the site exists to publish.
- **The prefix is what makes this expressible.** nginx resolves plain prefix
  locations by longest match, so `location /admin/` wins over `location /`
  wherever it sits in the file — order is not the mechanism. What matters is
  that removing that block does not fail loudly: it silently publishes the
  status pages, and there is no second gate behind it. If a future page under
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

> ⚠️ The gate matches `/admin/` with a trailing slash. Bare `/admin` falls
> through to the docs catch-all and 404s today, because no page is defined
> there — harmless now, but adding `web/src/app/admin/page.tsx` would serve it
> ungated. If that page is ever wanted, widen the nginx match at the same time.

One caveat is specific to the Podman runtime:

> ⚠️ Under **rootless** Podman, published ports pass through a userspace
> forwarder. If it does not preserve the client's source address, nginx's per-IP
> `limit_req` collapses into a single shared bucket for the entire internet —
> and the login throttle behind it is keyed by phone number, so it does not
> cover the gap. Verify this on the host before trusting the limit; see
> "Rootless Podman" in [`infra/podman/README.md`](../../infra/podman/README.md).

So: browser visitors get the Basic Auth key, phone testers get a demo account.

> ⚠️ Registration stays open to anyone who reaches `/graphql` — inherent to a
> public demo, with the rate limit as the only mitigation. If that becomes a
> problem, gate `register` in the gateway, not in nginx.

### Creating a demo account

There is no seed script. Register through the normal flow:

```bash
curl -s "https://$DOMAIN_NAME/graphql" \
  -H 'content-type: application/json' \
  -d '{"query":"mutation($i:RegisterInput!){register(input:$i){token}}","variables":{"i":{"firstname":"Demo","lastname":"User","phone":"0800000000","password":"CHANGE_ME"}}}'
```

`phone` is the login identity (9–15 digits, unique). The account gets
`role=patient`; `developer` cannot be self-registered. Treat the credential as
published, not secret — the account's blast radius is what protects you.

### Building the client against the deployed host

No source change needed:

```bash
EXPO_PUBLIC_API_URL=https://bp-monitor.example.com/graphql pnpm --dir client android
```

The value must include the `/graphql` path.

### Model weights on first container start

The `ai-service` image does not ship `*.onnx` or `templates.npz`.
`docker-entrypoint.sh` downloads them from `$AI_MODELS_R2_BASE_URL` into
`/app/models` and verifies sha256 against `models/EXPECTED_HASHES.json`, and
refuses to start on any mismatch. A named volume (`ai_models` on Compose,
`bp-ai-models` on Podman) persists them across recreates, so only the first boot
pays the ~78 MB — and the first boot needs outbound HTTPS.

Set `AI_MODELS_R2_BASE_URL` before the first start; the placeholder is rejected.
Rationale: [ADR-005](../decisions/ADR-005-model-weights-from-r2.md).

The manifest is baked into the image and re-checked on **every** start, not only
when a file is missing, so a cache volume cannot drift the server's detector away
from the phone's — `client/scripts/verify-models.mjs` hashes the bundled
`yolo11n.onnx` and `crnn.onnx` against that same manifest. The real drift risk is
building the server image from a different commit than the mobile build came
from, which is why the Podman images are tagged with the git SHA.

### Never commit a real `.env`

Only `.env.example` and `bp-monitor.env.example` are tracked. Production
credentials live in Podman secrets on the host, referenced by name.
