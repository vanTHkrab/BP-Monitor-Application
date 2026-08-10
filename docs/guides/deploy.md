---
title: Deploying the backend stack
description: The two runtimes — Podman Quadlet on EC2 behind a Cloudflare Tunnel for production, Docker Compose for development — plus the tunnel setup, the access model, and the Supabase database split.
status: current
updated: 2026-08-09
owner: cross
---

# Deploying the backend stack

Covers `api-gateway`, `ai-service`, Redis, nginx, and the Cloudflare Tunnel
connector. The mobile client is not containerised — it ships through Expo.

> **`web/` is not deployed.** The Next.js dashboard runs locally against the
> datastores and is defined only in the development Compose stack. It has no
> authentication of its own, its `/admin/` pages open direct connections to
> Postgres, Redis and S3, and the only thing that ever guarded them was an
> nginx Basic Auth rule. See [Running the dashboard](#running-the-dashboard).

## Which runtime am I on?

There are **two**, and they are not variants of each other. Pick by what you are
doing, not by which one you have used before.

| | **Podman Quadlet on EC2** | **Docker Compose** |
| --- | --- | --- |
| Status | **Production** | **Development** |
| Files | [`infra/podman/`](../../infra/podman/) | [`infra/docker-compose/`](../../infra/docker-compose/) |
| Supervisor | systemd (user manager) | `docker compose` |
| Ingress | Cloudflare Tunnel → nginx | published host ports |
| TLS | Cloudflare edge | none |
| Postgres | **Supabase, hosted off-box** | `postgres` container |
| Redis | container + volume | container + volume |
| `web` dashboard | **not deployed** | `docker-compose.dev.yml` |
| Logs | `journalctl --user -u bp-*` | `docker compose logs` |
| Migrations | manual `bp-migrate.service` | run by hand |
| Reference | [`infra/podman/README.md`](../../infra/podman/README.md) | [`infra/README.md`](../../infra/README.md) |

If you are deploying to the internet, you want the Podman path. If you are
running the stack on your laptop, you want Compose.

Two things are shared and documented once, at the bottom:
[the access model](#the-access-model) and
[model weights on first start](#model-weights-on-first-container-start).

---

## How ingress works now

This changed, and the change is the reason several old steps are gone.

```text
        phone / browser
              │  https://api.example.com/graphql
              ▼
      ┌───────────────────┐
      │ Cloudflare edge   │  TLS terminates HERE. WAF, HSTS, Access.
      └─────────┬─────────┘
                │  outbound-initiated, encrypted tunnel
                │  (the EC2 host dialled OUT; nothing dialled in)
                ▼
  ╔═════════════════════════ EC2 instance ═════════════════════════╗
  ║  inbound security group: EMPTY. no published port anywhere.    ║
  ║                                                                ║
  ║   cloudflared ──http──▶ nginx:80 ──▶ api-gateway:3000          ║
  ║                          (gate)      │        │                ║
  ║                                      │        └──▶ Redis ──▶ ai-service
  ║                                      ▼                         ║
  ╚══════════════════════════════════════│═════════════════════════╝
                                         ▼
                              Supabase Postgres · S3/R2
```

Three consequences worth internalising before you follow the steps:

- **There is no certificate to manage.** certbot, the ACME challenge webroot,
  `init-letsencrypt.sh`, the `CERTBOT_*` variables and the rootless-low-port
  sysctl are all gone. nginx starts on a bare host with no bootstrap.
- **There is no DNS record to create.** Cloudflare writes the CNAME when you
  add the Public Hostname. You do not point anything at an Elastic IP.
- **Routing lives in a dashboard, not in this repo.** That is the real cost.
  A hostname can be repointed by anyone with Cloudflare access and no diff
  records it. `DOMAIN_NAME` in the host env file is this repo's only claim
  about what the stack answers to; keep the two in step by hand.

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

- **Pooled, transaction mode, port 6543** — for `api-gateway`.
- **Direct or session pooler, port 5432** — for migrations only.

They are not interchangeable. Migrations need session-scoped state (an advisory
lock, DDL in a transaction) that a transaction-mode pooler cannot hold. Runtime
traffic on the direct endpoint burns the connection ceiling.

Append `sslmode=require` to both: the connection leaves the host.

> ⚠️ Supabase's direct hostname is IPv6-only for projects without the IPv4
> add-on. On an IPv4-only EC2 subnet it is simply unreachable, and the failure
> looks like DNS. Use the **session-mode** pooler on 5432 for migrations in that
> case. Check with `getent hosts` before assuming.

**2. Launch the instance.** t3.medium (4 GiB) recommended, ≥ 20 GiB disk. The
resource ceilings across the units total ~3.3 GiB, and images are built on the
box — a t3.small will run the stack but leaves nothing for a build. **No Elastic
IP is needed**: nothing connects inbound.

**3. Security group.**

- **Inbound: nothing. Zero rules.** This is the point of the tunnel. Reach the
  box through SSM Session Manager rather than an inbound SSH rule.
- Outbound: tcp/443 to Cloudflare (the tunnel itself), tcp/6543 and tcp/5432 to
  Supabase, tcp/443 for R2 model artifacts, the S3 endpoint and image
  registries, plus DNS. The full table is in the Podman README.

**4. Create the tunnel, in the Cloudflare dashboard.** Zero Trust → Networks →
Tunnels → **Create a tunnel** → *Cloudflared*. Name it, then copy the **token**
from the install command it shows you — ignore the rest of that command, the
connector runs as a container here. Leave the Public Hostname for step 15; it
cannot resolve `nginx` until the network exists.

### Host setup

```bash
# 5. Podman and git. Confirm the version — these units were written for 5.x.
sudo dnf install -y podman git     # Amazon Linux 2023 / RHEL family
podman --version

# 6. Keep the user manager alive after logout. WITHOUT THIS, the entire stack
#    stops the moment your SSH session ends.
sudo loginctl enable-linger "$USER"
loginctl show-user "$USER" -p Linger        # expect Linger=yes

# 7. Clone to /opt/bp-monitor — the unit files hard-code this path.
sudo install -d -o "$USER" -g "$USER" /opt/bp-monitor
git clone <repo-url> /opt/bp-monitor
cd /opt/bp-monitor
```

Everything from here runs as the **deploy user**, never as root. `install.sh`
refuses to run as root, because rootful changes the SELinux flags and the
linger requirement at once.

> The `net.ipv4.ip_unprivileged_port_start=80` sysctl that earlier versions of
> this guide required is **no longer needed**. nginx binds no host port. If you
> set it on an existing host, you can remove
> `/etc/sysctl.d/99-bp-monitor-ports.conf`.

### Configuration and secrets

```bash
# 8. Non-secret configuration.
sudo install -d -m 0755 -o "$USER" -g "$USER" /etc/bp-monitor
install -m 0640 infra/podman/bp-monitor.env.example /etc/bp-monitor/bp-monitor.env
$EDITOR /etc/bp-monitor/bp-monitor.env
```

At minimum set `DOMAIN_NAME`, `BETTER_AUTH_URL`, `AI_MODELS_R2_BASE_URL` and the
`S3_*` block. `BETTER_AUTH_URL` is **origin only** and must match `DOMAIN_NAME`:

```bash
DOMAIN_NAME=api.example.com
BETTER_AUTH_URL=https://api.example.com     # no path — /api/auth is appended
```

Getting `BETTER_AUTH_URL` wrong costs nothing at boot and 404s every auth route
afterwards, including the mobile app's email-OTP verification, which calls
`POST /api/auth/email-otp/*` directly.

```bash
# 9. Secrets — six of them, piped so no value lands in shell history.
printf '%s' 'postgresql://USER:PASS@REGION.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1' \
  | podman secret create bp-database-url -
printf '%s' 'postgresql://USER:PASS@REGION.pooler.supabase.com:5432/postgres?sslmode=require' \
  | podman secret create bp-database-url-direct -
printf '%s' '<long random string, 32+ chars>' | podman secret create bp-jwt-secret -
printf '%s' '<S3 access key id>'              | podman secret create bp-s3-access-key-id -
printf '%s' '<S3 secret access key>'          | podman secret create bp-s3-secret-access-key -
printf '%s' '<tunnel token from step 4>'      | podman secret create bp-tunnel-token -

podman secret ls        # expect six
```

```bash
# 10. Basic Auth credential for /graphiql. Gitignored; the directory is
#     tracked, the file is not.
podman run --rm docker.io/library/httpd:2.4-alpine \
  htpasswd -nbB demo 'YOUR_DEMO_KEY' > infra/nginx/auth/.htpasswd
```

### Install, build, migrate, start

```bash
# 11. Install the Quadlet units into your user systemd.
./infra/podman/scripts/install.sh
systemctl --user list-unit-files 'bp-*'      # must not be empty

# 12. Build the two images on the host (git SHA + latest).
./infra/podman/scripts/build-images.sh
# Then set BP_IMAGE_TAG in /etc/bp-monitor/bp-monitor.env to the SHA it printed.
```

```bash
# 13. Migrations — BEFORE starting the gateway that expects the new schema.
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
# 14. Up, and enable at boot.
systemctl --user start bp-monitor.target
systemctl --user enable bp-monitor.target
systemctl --user list-units 'bp-*'
```

**15. Point the tunnel at nginx** — back in the Cloudflare dashboard, on the
tunnel from step 4: **Public Hostname** → *Add a public hostname*.

| Field | Value |
| --- | --- |
| Subdomain | `api` |
| Domain | `example.com` |
| Path | *(leave empty)* |
| Type | `HTTP` |
| URL | `nginx:80` |

`nginx` resolves because the connector container is on `bp-net` and Podman's
aardvark-dns keys off the container name.

> ⚠️ **Point it at `nginx`, never at `api-gateway`.** nginx owns the `/graphiql`
> Basic Auth gate and the per-IP flood guard on `/graphql`. A hostname wired
> straight to the gateway removes both, and nothing anywhere reports that it
> happened.

Under *Additional application settings → TLS*, leave everything default: the hop
is plain HTTP inside the host's private network and Cloudflare knows it.

**16. Turn on the edge settings this stack now depends on** — SSL/TLS →
Overview → **Full** (not Flexible), Edge Certificates → **Always Use HTTPS** on
and **HSTS** on. The origin no longer redirects HTTP→HTTPS or sends HSTS; those
moved to the edge with TLS.

### Smoke-check — from outside the host

This matters more than it used to. Nothing on the box listens on a public port,
so a check run on the host proves only that the containers talk to each other —
it cannot tell you the tunnel is up.

```bash
# The API itself.
curl -sS https://api.example.com/graphql \
  -H 'content-type: application/json' -d '{"query":"{hello}"}'

# The gate. 401 means Basic Auth is doing its job.
curl -sS -o /dev/null -w '%{http_code}\n' https://api.example.com/graphiql

# Better Auth's routes reach the gateway and not a 404 page.
curl -sS -o /dev/null -w '%{http_code}\n' https://api.example.com/api/auth/ok

# Passkeys: must be JSON with your fingerprints, not an HTML 404.
curl -sS https://api.example.com/.well-known/assetlinks.json
```

The last two are the routes that were silently broken before this change: the
nginx catch-all pointed at the dashboard, so both returned a Next.js 404.

On the host, confirm the tunnel registered and ai-service finished its download:

```bash
podman healthcheck run cloudflared && echo tunnel-ok
journalctl --user -u bp-cloudflared.service -n 20 --no-pager  # "Registered tunnel connection"
podman healthcheck run ai-service && echo ai-ok
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

`redeploy.sh` rebuilds, restarts the app units, then **nginx, then cloudflared**.
That tail is not cosmetic. nginx resolves `proxy_pass http://api-gateway:3000`
once, at config load, so a recreated gateway on a new address means every request
502s until nginx re-resolves; and cloudflared caches nginx's address for the life
of a connection, so restarting nginx alone can leave the tunnel pointing at an
address that no longer exists — 502 at the edge while every container reports
healthy.

### Rolling back

Images carry the git SHA as well as `latest`, so a rollback is a retag and a
restart — no rebuild:

```bash
podman tag localhost/bp-monitor/api-gateway:<old-sha> localhost/bp-monitor/api-gateway:latest
podman tag localhost/bp-monitor/ai-service:<old-sha>  localhost/bp-monitor/ai-service:latest
systemctl --user restart bp-api-gateway bp-ai-service bp-nginx bp-cloudflared
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

### When the site is down but everything is healthy

The failure mode this architecture adds. Work down the list:

1. `podman healthcheck run cloudflared` — is the connector connected at all?
2. `journalctl --user -u bp-cloudflared -n 50` — look for
   `Registered tunnel connection`. Repeated `Unauthorized` means the token is
   wrong or the tunnel was deleted in the dashboard.
3. Cloudflare dashboard → the tunnel → is its status **Healthy**, and does the
   Public Hostname still read `api.example.com → HTTP://nginx:80`?
4. `podman exec nginx wget -qO- 'http://127.0.0.1/graphql?query=%7Bhello%7D'` —
   proves nginx is serving and still resolves the gateway. A failure here with a
   healthy gateway is the stale-upstream case: `systemctl --user restart bp-nginx`.

---

## Development — Docker Compose

This stack includes a `postgres` container — it is the *development* database.
Production Postgres is Supabase and lives nowhere in these files. Full option
reference and per-service reasoning: [`infra/README.md`](../../infra/README.md).

```bash
cd infra/docker-compose
cp .env.example .env       # then edit
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

`DATABASE_URL`'s host must be `postgres` and Redis's must be `redis` — the
Compose service names. `localhost` inside a container is that container.

### Automated deploys (GitHub Actions -> AWS SSM)

`.github/workflows/deploy-server.yml` deploys this stack on every push to
`main` that touches `server/**` or `infra/**`.

**It goes through AWS Systems Manager, not SSH, and that is not a preference.**
The instance has no inbound security-group rule — cloudflared dials out and
nothing dials in. SSH from a runner would mean opening a port and handing back
the property the tunnel exists to provide. SSM inverts the direction the same
way the tunnel does: the agent on the instance polls AWS, and the workflow
leaves a command for it to collect.

The workflow only *invokes*; the steps live in
[`infra/scripts/deploy-compose.sh`](../../infra/scripts/deploy-compose.sh), so
they are reviewable in a PR and an operator can run the identical thing by hand
during an incident:

```bash
sudo /opt/bp-monitor/infra/scripts/deploy-compose.sh <git-sha>
```

The script derives the repository root from its own location, so the checkout
can live anywhere; `/opt/bp-monitor` is what this host uses, and it is also what
the Podman runtime's unit files hardcode, so one checkout serves both. The
workflow needs the absolute path to invoke it, and that lives in one place — the
`EC2_REPO_DIR` value in the workflow's `env:` block.

> ⚠️ **Never write `~` in the workflow.** SSM runs `AWS-RunShellScript` as
> **root**, so `~/BP-Monitor-Application` would expand to
> `/root/BP-Monitor-Application` — a path that resolves correctly when you test
> it over SSH as the deploy user and does not exist under SSM. The failure is
> quiet and reads as a missing script. If the checkout ever moves into a home
> directory, spell it out (`/home/ec2-user/...`, `/home/ubuntu/...`).

The script checks out an exact SHA rather than pulling `main`, so the running
code is the commit that triggered the deploy and not whatever `main` advanced
to while the build was queued. It refuses to run on a dirty working tree —
an unexplained local edit on the box is more often an in-progress incident fix
than a mistake, and `git reset --hard` would destroy it silently. It passes
`--remove-orphans`, which is what finally clears the `web` and `certbot`
containers from hosts that ran an older revision of this stack.

> ⚠️ **Migrations are not run.** Deliberate, for the same reason
> `bp-migrate.service` is a manual gate: a restart policy plus migrate-on-boot
> turns a crash loop into repeated schema mutations against live patient data.
> A deploy that ships one is two steps, in this order:
>
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.prod.yml \
>   run --rm api-gateway pnpm prisma migrate deploy    # you, by hand
> git push origin main                                  # then the code
> ```

Setup the workflow cannot do for itself — an IAM role assumed via OIDC (scoped
to `refs/heads/main`, not the whole repo), the SSM agent with
`AmazonSSMManagedInstanceCore`, and three repository *variables*
(`AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `EC2_INSTANCE_ID`) — is written up in the
workflow's own header.

### The prod-shaped stack

`docker-compose.prod.yml` is a **rehearsal**, not production: built images,
restart policies, nginx, and a `cloudflared` service, with Postgres still in a
container.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Leave `TUNNEL_TOKEN` empty unless you mean it — a real token publishes your
laptop on a real hostname. Exercise nginx from inside the network instead:

```bash
docker compose exec nginx wget -qO- 'http://127.0.0.1/graphql?query=%7Bhello%7D'
```

### Running the dashboard

`web/` is in `docker-compose.dev.yml` and nowhere else. That is not tidiness: a
Compose override can change a service but cannot delete one, so a definition in
the base file would start it in the prod-shaped stack too.

It comes up on <http://localhost:3001>, with `DATABASE_URL`, `REDIS_HOST` and the
`S3_*` block wired to the Compose services — none of which were passed before
this change, which is why every `/admin/` page except the gateway probe reported
its service as down with nothing in a log to explain it.

To point it at **production** datastores, run it outside Docker with a `.env.local`
holding the Supabase URL and the R2 credentials. Do not deploy it to reach them:
it has no login, and `/admin/` renders session counts and user totals.

---

## Shared by both runtimes

### The access model

nginx serves the same config in both runtimes
([`infra/nginx/templates/default.conf.template`](../../infra/nginx/templates/default.conf.template)).

| Route | Goes to | Gate |
| --- | --- | --- |
| `/graphql` | api-gateway | **None** — JWT auth + nginx rate limit only |
| `/graphiql` | api-gateway | Basic Auth **and** `GRAPHIQL_ENABLED` set to `1`/`true`/`yes`/`on` |
| `/api/auth/*` | api-gateway | **None** — Better Auth's own routes; throttled per credential |
| `/.well-known/assetlinks.json` | api-gateway | **None**, and must stay that way — Google's servers fetch it |
| everything else | api-gateway | **None** |

The reasoning:

- **The catch-all points at the gateway, and that is load-bearing.** It used to
  point at the Next.js dashboard, which meant `/api/auth/*` and
  `/.well-known/assetlinks.json` — both real gateway routes with no `location`
  of their own — returned a Next.js 404. Email-OTP verification was broken in
  production and Android could never accept a passkey. If you add a location
  above the catch-all, do not shrink what the catch-all reaches.
- **GraphiQL must be gated** and is additionally off by default in production.
  A schema explorer with mutation access to live patient data is not something
  to serve casually. The env gate and the Basic Auth gate fail differently —
  neither is redundant.
- **`/graphql` cannot be gated.** The mobile client sends `Content-Type` and
  `Authorization: Bearer <jwt>` with no hook for a second credential, and
  `Authorization` is already taken. Adding Basic Auth would break every
  installed app. It keeps its own auth, its own throttle, and a per-IP
  `limit_req` in nginx (10 r/s, burst 40, real `429`) as a flood guard.
- **The per-IP limit only works because of `real_ip`.** Behind the tunnel every
  request arrives from the `cloudflared` container's address. Without
  `set_real_ip_from` + `real_ip_header CF-Connecting-IP`, `$binary_remote_addr`
  is one value for the entire internet: all users share one 10 r/s budget and
  one flooder 429s everybody. The limit still "works" — it just keys on the
  wrong thing, and nothing logs that.

> ⚠️ Registration stays open to anyone who reaches `/graphql` — inherent to a
> public API, with the rate limit as the only mitigation. If that becomes a
> problem, gate `register` in the gateway, not in nginx.

Cloudflare Access in front of the hostname is a strictly better gate than Basic
Auth for `/graphiql`, because it authenticates before a request reaches the
tunnel. It is not assumed anywhere in these files: the config has to keep
working whether or not someone configures it in the dashboard.

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
EXPO_PUBLIC_API_URL=https://api.example.com/graphql pnpm --dir client android
```

The value must include the `/graphql` path.

### Passkeys need the RP ID and the served domain to agree

`PASSKEY_RP_ID` must be the same domain that serves
`/.well-known/assetlinks.json`. This stack serves it from the gateway at
`https://$DOMAIN_NAME/.well-known/assetlinks.json`, so with
`DOMAIN_NAME=api.example.com` the RP ID must be `api.example.com` too. Setting
it to the bare `example.com` means Android fetches the file from a host this
stack does not serve, and rejects the passkey with no useful message.

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

Both service build contexts carry a `.dockerignore`
([api-gateway](../../server/app/api-gateway/.dockerignore),
[ai-service](../../server/app/ai-service/.dockerignore)) because their
Dockerfiles do `COPY . .`: without one, a developer's `.env` is baked into an
image layer, a host-built `node_modules` / `.venv` silently replaces the one the
image built, and ai-service ships the 78 MB of weights it is designed to fetch
at runtime. `build-images.sh` refuses to build if either file is missing.
