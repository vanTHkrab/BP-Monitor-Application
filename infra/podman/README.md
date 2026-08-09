# infra/podman — production runtime (single EC2 host, Podman Quadlet)

**This is the production runtime.** The Docker Compose stack in
[`../docker-compose/`](../docker-compose/) is the **development** runtime and
stays exactly as it is. Nothing here replaces it, and the two are not meant to
be run on the same machine.

The step-by-step sequence lives in
[`docs/guides/deploy.md`](../../docs/guides/deploy.md). This file is the
reference: the unit topology, every decision and what it cost, and the parts a
human has to do by hand.

> ⚠️ **Nothing in this directory has been executed.** No unit has been loaded by
> a systemd generator, no image has been built with Podman, no container has
> started, and no EC2 host was involved. Podman is not installed on the machine
> this was written on. Treat every file here as a reviewed design that still
> needs its first real run — the "What was not verified" section at the bottom
> is the honest list.

---

## How this differs from the Compose stack

| | Compose (`../docker-compose/`) | Podman Quadlet (here) |
| --- | --- | --- |
| Purpose | Development | **Production** |
| Supervisor | `docker compose` | systemd (user manager) |
| Postgres | `postgres` container + volume | **Supabase, hosted — not on the box** |
| Redis | container + volume | container + volume (unchanged) |
| api-gateway / ai-service | containers | containers (same images, same `prod` targets) |
| `web` dashboard | dev stack only | **not deployed** |
| Ingress | published `80`/`443` | **Cloudflare Tunnel — no published port at all** |
| TLS | certbot / Let's Encrypt on the box | Cloudflare edge |
| nginx | container | container (same config files, reused verbatim) |
| Logs | `docker compose logs` | journald (`journalctl --user -u bp-*`) |
| Restart / boot | `restart: unless-stopped` | systemd `Restart=always` + `enable-linger` |
| Migrations | not automated | `bp-migrate.service`, manual gate |

Everything the prod Compose file gained as a *security* decision survives, because
it is enforced in files this runtime reuses rather than copies:

- **Nothing on this host binds a public port.** `cloudflared` dials *out* to
  Cloudflare and forwards to `nginx:80` over `bp-net`. No unit has a
  `PublishPort=`, and the instance's inbound security group should be empty.
  This replaces "nginx is the sole public ingress" and is strictly stronger.
- **ai-service is neither published nor proxied.** It is reached over Redis
  pub/sub from the gateway, and by nothing else — its second consumer, the
  dashboard's `/health` probe, went away with the dashboard.
- **Redis is not published.**
- **`/graphiql` is behind Basic Auth; `/graphql` is not and must not be;
  everything else reaches the gateway.** That is
  [`../nginx/templates/default.conf.template`](../nginx/templates/default.conf.template),
  mounted here unchanged.
- **The dashboard was removed rather than gated.** `web` has no authentication
  of its own and its `/admin/` pages read Postgres, Redis and S3 directly. The
  only thing that ever guarded them was one nginx `location` block whose
  deletion fails silently. Not deploying it is the version of that decision
  that cannot regress.

---

## Unit topology

```text
                        bp-monitor.target
                    (one handle for the stack)
                               │
        ┌──────────────┬───────┴───────┬──────────────┐
        │              │               │              │
   bp-redis      bp-api-gateway    bp-ai-service    bp-nginx
   (Redis)            │  ▲              ▲              ▲
        ▲             │  │              │              │
        └─────────────┘  │              │              │
         Requires/After  └──────────────┘              │
                                                       │
                                                 bp-cloudflared
                                              (dials OUT to Cloudflare)
                                                       │
                       bp-net.network ──────────────────┘
                       (aardvark-dns: container name == hostname)
```

Boot ordering, and why each edge exists:

| Unit | `Requires=` / `After=` | Why |
| --- | --- | --- |
| `bp-redis` | — | Starts first. Nothing it depends on is on this host. |
| `bp-api-gateway` | `bp-redis` | Publishes `analyze_bp_image`. Also *tolerates* Redis being down (`RedisModule` lazy-connects and suppresses errors), so this is ordering hygiene, not a hard requirement. |
| `bp-ai-service` | `bp-redis` | Its subscriber needs somewhere to subscribe. It retries, so again ordering rather than a hard gate. |
| `bp-nginx` | `bp-api-gateway` | **A hard requirement.** nginx resolves `proxy_pass http://api-gateway:3000` at config-load time and refuses to start if the name does not resolve — which on a Podman network means the container is not running. Verified: `nginx -t` on this template fails with `host not found in upstream "api-gateway"`. |
| `bp-cloudflared` | `bp-nginx` | Its only origin is `nginx:80`. Starting first just means a window of 502s at the edge. |
| `bp-migrate` | **none — not in the target** | Deliberate. See below. |

Ordering is `After=` only; no unit waits for another to be *healthy*. Podman 5.0
adds `Notify=healthy`, which would make systemd hold a dependent unit until the
healthcheck passes, and it is the better mechanism — it is not used here because
it silently changes behaviour on Podman 4.x (Ubuntu 24.04 ships 4.9) and the
services already tolerate a not-yet-ready Redis by design. Adopt it once the
host's Podman version is pinned and known. Healthchecks are declared regardless,
for `podman ps` and for operators.

### Files

```text
infra/podman/
├── README.md                       # this file
├── bp-monitor.env.example          # -> /etc/bp-monitor/bp-monitor.env (non-secret)
├── quadlet/                        # -> ~/.config/containers/systemd/
│   ├── bp-monitor.target
│   ├── bp-net.network
│   ├── bp-redis-data.volume
│   ├── bp-ai-models.volume
│   ├── bp-redis.container
│   ├── bp-api-gateway.container
│   ├── bp-ai-service.container
│   ├── bp-nginx.container
│   └── bp-cloudflared.container
├── systemd/
│   └── bp-migrate.service          # -> ~/.config/systemd/user/  (manual gate)
└── scripts/
    ├── install.sh                  # install units into the user's systemd
    ├── build-images.sh             # build the two app images on the host
    └── redeploy.sh                 # rebuild + restart + bounce nginx, then the tunnel
```

Each unit file carries its own reasoning in comments. This README does not
repeat them; it covers the decisions that span units.

---

## Decisions

### Quadlet, not `podman-compose` or `podman play kube`

Given (not re-opened). What it buys: systemd owns lifecycle, restart backoff,
boot ordering and journald logging, so there is exactly one supervisor on the
box instead of a supervisor supervising a supervisor. What it costs: the units
are more verbose than a Compose file, dependency edges are hand-written rather
than inferred from `depends_on`, and there is no `up --build` — build and
restart are separate steps (hence `scripts/redeploy.sh`).

### Rootless Podman

**Chosen: rootless**, running as an ordinary deploy user with lingering enabled.

Trade-off taken. Rootless means a container escape lands on an unprivileged user
account rather than on root, and the whole stack's state lives under
`~/.local/share/containers` where it can be inspected and destroyed without
`sudo`. That is the security win, and on a single host with an unauthenticated
ai-service in the stack it is the one worth having.

What it costs, concretely — these are not theoretical:

1. **Low ports are no longer a problem at all.** This used to be the headline
   cost: a non-root process cannot bind below 1024, handled with a persistent
   `net.ipv4.ip_unprivileged_port_start=80` sysctl that lowered the privileged
   floor for every user on the host. With the tunnel, **nginx binds no host
   port**, so the sysctl is gone and so is the widening. If you set it on an
   existing host, remove `/etc/sysctl.d/99-bp-monitor-ports.conf`.
2. **`loginctl enable-linger` is mandatory.** Without it, systemd tears down the
   user manager at logout and takes the entire production stack with it. This
   is the single most likely way to break this deploy, and it breaks it at the
   moment you disconnect, not at the moment you make the mistake.
3. **Source IP — the concern moved, it did not go away.** nginx's flood guard is
   `limit_req_zone $binary_remote_addr`, and the gateway's login throttle is
   keyed by phone number, so the nginx per-IP limit is the only thing that slows
   an attacker rotating credentials.

   The old risk was the rootless port forwarder (`pasta` / `slirp4netns`)
   rewriting every client to one address. That risk is gone with the published
   port. The **new** one is structural and certain rather than
   version-dependent: behind a tunnel, every request reaches nginx from the
   `cloudflared` container's address. The template handles it with

   ```nginx
   set_real_ip_from 10.0.0.0/8;      # + 172.16/12, 192.168/16
   real_ip_header   CF-Connecting-IP;
   ```

   Trusting the RFC1918 ranges is safe *because* nginx publishes no host port:
   only a container on `bp-net` can reach it, so there is no route an untrusted
   party could spoof the header from. Verify what nginx actually sees before
   trusting the limit:

   ```bash
   podman exec nginx tail -20 /var/log/nginx/access.log
   ```

   If the source column is one internal address for every request, `real_ip` is
   not taking effect and the limit is a single shared bucket for the whole
   internet — a failure that looks exactly like a working rate limiter.
4. **SELinux relabelling.** Amazon Linux 2023 and the RHEL family run SELinux
   enforcing. Every host bind mount in these units carries `:z`. Omitting it
   produces a permission error that reads like a missing file.

Rootful would have made 4 disappear and would not help with 2 or 3. The tunnel
already removed the biggest item on this list. What is left is one verification
and one mount flag — rootless is now clearly the cheaper side of the trade.

### nginx stays; certbot is gone; TLS moved to Cloudflare

**Chosen: keep nginx's config unchanged, drop TLS termination and certbot.**

The earlier version of this document argued against moving TLS to Cloudflare, on
the grounds that the template, the reload loop, the Basic Auth gate and the
`/graphql` rate limit "already encode a reviewed access model" and that
re-terminating TLS elsewhere would mean re-deriving it — which is how a gate
quietly goes missing. That reasoning was sound and is the reason for the shape
of this change: **nginx stayed.** The access model was not re-derived anywhere.
What moved is only the layer that encrypts the connection.

What that buys:

- **No inbound port, and no inbound security-group rule.** The host is not
  addressable from the internet at all. This is a larger reduction in exposure
  than any config change inside the box could be.
- **No certificate lifecycle.** No first-issuance bootstrap that has to run
  before nginx can start, no ACME challenge webroot shared between two
  containers, no renewal loop, no rate limit to burn on a failed attempt, and
  no cert-expiry outage. Three files and two units deleted.
- **No DNS record to own.** Cloudflare writes the CNAME when the Public
  Hostname is added.
- **A WAF and Cloudflare Access available** in front of everything, at the edge.

What it costs, and this is the part to keep in view:

- **Routing lives in a dashboard.** A Public Hostname can be repointed or
  deleted by anyone with Cloudflare access, and no diff records it. Worse, the
  specific mistake — pointing it at `api-gateway:3000` instead of `nginx:80` —
  produces a *working site* with the `/graphiql` gate and the flood guard
  silently removed. `DOMAIN_NAME` here is the repo's only claim about what this
  stack answers to.
- **A new dependency and a new failure mode.** "Every container healthy, site
  down" is now possible; it was not before. The deploy guide has a triage list.
- **Cloudflare sees plaintext.** They terminate TLS, so they can read request
  bodies — including auth payloads. That is inherent to any CDN-terminated
  design and is the price of the edge features.

The one thing knowingly left as-is: `bp-cloudflared` uses the `:latest` tag
while this project pins its own images, for the same reason certbot's tag was
unpinned — the connector tracks a protocol Cloudflare evolves, and a stale pin
is a known way for a tunnel to start failing. Bump it by hand as maintenance:
`podman pull docker.io/cloudflare/cloudflared:latest && systemctl --user restart bp-cloudflared`.

### Images are built on the host

**Chosen: build on the box**, tagged with the git short SHA and `latest`.

There is no CI in this repository — `.github` does not exist — so the options
were "build here" or "build elsewhere and ship a tarball". Building here means
the image provably matches the checkout at `/opt/bp-monitor`; a `podman save` /
`scp` / `podman load` loop has nothing tying the tarball to a commit except the
human carrying it.

What it costs, and this is the real constraint: **ai-service is not a small
image.** It resolves `onnxruntime` and `opencv-python-headless` wheels, and
while the model weights are fetched at runtime rather than baked in (ADR-005,
which is what keeps it from being ~2 GB), the dependency tree alone makes it the
largest of the three. The two Node builds each run a full `pnpm install` plus a
compile. On a t3.micro (1 GiB) that is a coin-flip against the OOM killer;
t3.small (2 GiB) with swap is the realistic floor and t3.medium (4 GiB) builds
without drama. Build time also competes with serving traffic, because it is the
same box.

`build-images.sh` refuses to build if `server/app/api-gateway/.env` exists — see
"Follow-ups" for why.

Revisit the moment CI exists: build once, push to a registry, host only pulls.

### Migrations are a manual, gated step

**Chosen: `bp-migrate.service`, `Type=oneshot`, not in `bp-monitor.target`,
started by hand.**

Against a container Postgres whose lifetime was the stack's lifetime,
migrate-on-boot is merely untidy. Against a hosted database it is a different
risk: the gateway has `Restart=always`, so a crash loop becomes repeated
schema-mutation attempts on the production database, and two containers starting
at once race for the migrate advisory lock.

The cost of the manual gate is that a deploy which ships a migration has one
more step a human can forget. `redeploy.sh` does not run it and says so; the
deploy guide puts it before the restart. The ordering rule stays additive schema
first, then code, with any drop in a later separate change — Prisma has no
down-migration here, so "roll back the code" must always be safe against the new
schema.

---

## Supabase

Postgres is hosted. That is not a URL swap, and these are the parts that bite.

### Two connection strings, not one

| | Endpoint | Port | Used by |
| --- | --- | --- | --- |
| Pooled (transaction mode) | `<region>.pooler.supabase.com` | **6543** | `api-gateway`, `web` — runtime traffic |
| Direct **or** session pooler | `db.<ref>.supabase.co` / `<region>.pooler.supabase.com` | **5432** | `bp-migrate.service` only |

They are not interchangeable in either direction. Runtime traffic on the direct
endpoint burns Supabase's connection ceiling — and this stack has *two* Postgres
clients, because `web/src/lib/db.ts` opens its own `pg` Pool straight at the
database rather than going through the gateway. Migrations on the transaction
pooler break: `prisma migrate deploy` takes a session-scoped advisory lock and
runs DDL in a transaction, and a transaction-mode pooler cannot hold session
state across statements.

**IPv4 gotcha.** Supabase's direct hostname is IPv6-only for projects without
the IPv4 add-on. An EC2 instance in an IPv4-only subnet cannot reach it at all,
and the failure looks like a DNS or timeout problem rather than a topology one.
If that is your situation, use the **session-mode** pooler on 5432 for
migrations — it holds session state, which is what Prisma actually needs. Check
before assuming:

```bash
getent hosts db.<ref>.supabase.co
getent hosts <region>.pooler.supabase.com
```

### `?pgbouncer=true&connection_limit=1`

The received wisdom is that Prisma needs these on a pooled URL. It is worth
being precise about what they do **in this codebase**, because this project is
on Prisma 7 with a driver adapter:

`prisma/schema.prisma` declares only `provider = "postgresql"` with no `url`,
and `src/prisma/prisma.service.ts` constructs the client as
`new PrismaPg({ connectionString })` — the `@prisma/adapter-pg` driver adapter,
i.e. node-postgres. The prepared-statement problem `pgbouncer=true` exists to
work around is a property of Prisma's own Rust query engine, which is not in
this path. node-postgres does not use named prepared statements unless you ask
it to.

So: `pgbouncer=true` is most likely a no-op here rather than load-bearing, and
`connection_limit` is a Prisma-engine parameter that `pg` does not read — pool
sizing for the adapter is a `PrismaPg` option, in application code. Carrying
both on the URL is harmless (`pg` ignores unrecognised query parameters) and
worth keeping as documentation of intent.

**This reasoning is from reading the code, not from running it against a real
Supabase pooler.** If you see `prepared statement "s0" already exists` under
load, that conclusion is wrong and the fix is a `prisma-dev` change to how
`PrismaPg` is constructed, not an infra change.

### TLS to the database

The connection now leaves the host and crosses the public internet, so TLS is
not optional. Append `sslmode=require` to both URLs at minimum.

`pg` reads `sslmode` from the connection string. `require` encrypts but does not
verify the server certificate against a CA; `verify-full` encrypts *and*
verifies hostname and chain, which is the setting that actually stops an
active man-in-the-middle — and it needs the CA to be trusted by the container.
The gateway's prod image is `node:24-alpine`, and Alpine's base image does ship
`ca-certificates`. Whether Supabase's pooler certificate chains to a publicly
trusted root (in which case `verify-full` just works) or to Supabase's own CA
(in which case the CA bundle has to be mounted into the container) **was not
verified here**. Check it once on the host:

```bash
podman run --rm localhost/bp-monitor/api-gateway:latest \
  node -e "require('tls').connect({host:'<region>.pooler.supabase.com',port:6543,servername:'<region>.pooler.supabase.com'},function(){console.log(this.authorized, this.authorizationError)})"
```

`true null` means `verify-full` will work with no extra CA. Anything else means
staying on `sslmode=require` until the CA is mounted — and knowing that you are
choosing encryption without authentication.

### Egress from the EC2 security group

Outbound rules the instance needs. Default AWS security groups allow all
outbound; if yours is locked down, these are the holes:

| Destination | Port | For |
| --- | --- | --- |
| Cloudflare edge | tcp/443 | **the tunnel itself — without this nothing is reachable** |
| Supabase pooler | tcp/6543 | runtime database traffic |
| Supabase direct / session pooler | tcp/5432 | `bp-migrate.service` |
| Cloudflare R2 | tcp/443 | ai-service model artifacts on first boot |
| S3 / R2 endpoint | tcp/443 | image upload and presigning |
| Image registries | tcp/443 | `podman pull` |
| DNS | udp/53, tcp/53 | everything |

**Inbound: nothing. Zero rules.** That is the point of the tunnel — the
connector dials out and the host is not addressable from the internet. This
replaces the previous "tcp/80 + tcp/443 from `0.0.0.0/0`". Not even SSH, if you
can reach the box through SSM Session Manager instead.

Note the asymmetry this creates: egress is now load-bearing in a way it was not.
A locked-down egress policy that misses Cloudflare takes the whole site down,
and the containers will all look healthy while it does.

### The credential

`DATABASE_URL` now carries a production credential to a third party. It is
injected as a **Podman secret**, not written into
`/etc/bp-monitor/bp-monitor.env`:

- stored under the deploy user's Podman store at mode 0600
- mounted into the container's process environment at start, never into an image
  layer and never onto a bind mount
- never in this repository, in any form, including examples

Rotating it is `podman secret rm` + `podman secret create` + restart. The
downside versus a systemd credential (`LoadCredentialEncrypted=`, which seals to
the host TPM) is that a Podman secret sits on disk in plaintext, readable by the
deploy user — the same user that can already `podman exec` into the container
and read the environment anyway. Systemd credentials would be the stronger
mechanism, at the cost of leaving Quadlet's native `Secret=` support unused.

---

## Secrets

Five, created once per host. Never with the value on the command line — it lands
in shell history.

```bash
printf '%s' 'postgresql://USER:PASS@REGION.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true&connection_limit=1' \
  | podman secret create bp-database-url -

printf '%s' 'postgresql://USER:PASS@REGION.pooler.supabase.com:5432/postgres?sslmode=require' \
  | podman secret create bp-database-url-direct -

printf '%s' '<a long random string, at least 32 chars>' \
  | podman secret create bp-jwt-secret -

printf '%s' '<S3 access key id>'      | podman secret create bp-s3-access-key-id -
printf '%s' '<S3 secret access key>'  | podman secret create bp-s3-secret-access-key -
```

Verify with `podman secret ls` (names and timestamps only — it will not print
values).

Two things that are *not* Podman secrets and still must never be committed:

- `infra/nginx/auth/.htpasswd` — the Basic Auth credential. Gitignored; only the
  directory is tracked. Generate it the same way the Compose stack does.
- `/etc/bp-monitor/bp-monitor.env` — non-secret configuration, but `DOMAIN_NAME`
  and the S3 endpoint are useful reconnaissance. Mode 0640, owned by the deploy
  user.

---

## Operating it

```bash
# Up / down / bounce
systemctl --user start   bp-monitor.target
systemctl --user stop    bp-monitor.target
systemctl --user restart bp-monitor.target

# What is running, and what failed
systemctl --user list-units 'bp-*'
systemctl --user --failed

# Logs — journald, not `podman logs`
journalctl --user -u bp-api-gateway.service -f
journalctl --user -u bp-ai-service.service --since '1 hour ago'
journalctl --user -u 'bp-*' --since today

# Container-level view
podman ps
podman stats --no-stream
podman healthcheck run api-gateway

# Redeploy from the current checkout
./infra/podman/scripts/redeploy.sh

# Migrations (only when the deploy ships one)
systemctl --user start bp-migrate.service
journalctl --user -u bp-migrate.service -n 100 --no-pager
```

### Resource budget

Set in each unit via `PodmanArgs=--memory=... --cpus=...`. Podman 5.0 exposes
`Memory=` as a first-class Quadlet key; `PodmanArgs` is used so the limits do
not silently no-op on 4.x.

| Unit | Memory | CPU | Note |
| --- | --- | --- | --- |
| `bp-redis` | 512m | 0.5 | See the `maxmemory` follow-up below |
| `bp-api-gateway` | 768m | 1.0 | |
| `bp-ai-service` | 1500m | 1.5 | Four ONNX sessions plus a 58 MB templates archive resident |
| `bp-nginx` | 256m | 0.5 | |
| `bp-cloudflared` | 256m | 0.5 | |
| **Total ceiling** | **~3.3 GiB** | | Does not fit a t3.small (2 GiB) with all five running |

**These are starting ceilings, not measurements.** Nothing here was profiled
against a real workload. The one that matters most is `bp-ai-service`: set it
too low and the container is OOM-killed mid-analysis, which surfaces to the
patient as an analysis that never returns a reply, not as an error. Watch
`podman stats` on real traffic before treating any of these numbers as correct.

Sum of ceilings is not sum of usage, but it does mean an instance smaller than
4 GiB will be relying on none of them peaking together. t3.medium is the
comfortable size; t3.small will run but leaves nothing for a build.

---

## What a human does by hand on a fresh EC2 host

None of this is automated, on purpose — provisioning-as-code was explicitly out
of scope. The full sequence with commands is in
[`docs/guides/deploy.md`](../../docs/guides/deploy.md); this is the checklist.

1. Launch the instance (t3.medium recommended, ≥ 20 GiB disk). **No Elastic IP
   needed** — nothing connects inbound.
2. Security group: **inbound nothing**; outbound per the egress table above.
3. Create the Cloudflare Tunnel in the dashboard (Zero Trust → Networks →
   Tunnels) and copy its token. Leave the Public Hostname until step 13 — it
   cannot resolve `nginx` before the network exists. **No DNS record of your
   own**; Cloudflare writes the CNAME.
4. Install `podman` and `git`. Confirm `podman --version` is ≥ 4.4 (5.x
   assumed).
5. `sudo loginctl enable-linger <deploy-user>`.
6. Clone the repo to `/opt/bp-monitor`, owned by the deploy user (the unit files
   hard-code this path in their bind mounts).
7. Create `/etc/bp-monitor/bp-monitor.env` from `bp-monitor.env.example` and
   fill it in — `DOMAIN_NAME` and `BETTER_AUTH_URL` must agree.
8. Create the six Podman secrets, including `bp-tunnel-token`.
9. Create `infra/nginx/auth/.htpasswd`.
10. Create the Supabase project, run the migrations once from a workstation or
    via `bp-migrate.service`, and confirm the schema.
11. `./infra/podman/scripts/install.sh`
12. `./infra/podman/scripts/build-images.sh`
13. `systemctl --user start bp-monitor.target`, then add the tunnel's **Public
    Hostname** in the dashboard: `api.<domain> → HTTP://nginx:80`. Then
    `systemctl --user enable bp-monitor.target`.
14. Smoke-check from **outside** the host — it is the only place that can tell
    you the tunnel is up.

Step 6 of the old sequence — the `net.ipv4.ip_unprivileged_port_start=80`
sysctl — is gone. nginx binds no host port.

---

## Follow-ups (found while building this, not fixed here)

1. ~~**`server/app/api-gateway/.env` is baked into the image.**~~ **Fixed.**
   Both service build contexts now carry a `.dockerignore`
   ([api-gateway](../../server/app/api-gateway/.dockerignore),
   [ai-service](../../server/app/ai-service/.dockerignore)). The ai-service one
   also stops a local checkout's `.venv` from replacing the image's own, and
   keeps the ~78 MB of model weights out of the image as ADR-005 intends.
   `build-images.sh` now hard-fails if either file goes missing.
   covering at least `.env`, `node_modules`, `dist`, `test`. Out of scope for
   this change (`infra/` and `docs/` only).
2. **Redis has no `maxmemory` / `maxmemory-policy`.** Unbounded, it grows until
   the container ceiling and gets OOM-killed; bounded with the wrong policy, it
   evicts rate-limit keys or stalls a pub/sub client output buffer. Both are
   runtime-behaviour changes to a shared transport, which makes it a `redis-dev`
   decision, not a deploy one. Raised, not decided.
3. **The tunnel's routing is not in version control.** The Public Hostname row
   lives in the Cloudflare dashboard, and the specific mistake — pointing it at
   `api-gateway:3000` instead of `nginx:80` — yields a *working site* with the
   `/graphiql` gate and the per-IP flood guard silently gone. `cloudflared`
   supports a file-based config that would make ingress reviewable, at the cost
   of a second place routing lives. Worth revisiting if more than one person
   holds Cloudflare access.
4. **No observability beyond journald.** No metrics, no traces, no alerting, and
   nothing watching whether the certificate actually renewed. On a single host
   `journalctl` plus an uptime check is a defensible MVP, but "the certificate
   silently stopped renewing" is a real failure mode with a 90-day fuse and
   nothing here would catch it before a browser did. The cheapest useful
   addition is an external uptime monitor on
   `https://$DOMAIN_NAME/graphql`. Certificate expiry is no longer something to
   watch — Cloudflare owns it — but "the tunnel disconnected" replaces it as the
   failure a monitor exists to catch, and it is the one where every container on
   the box reports healthy.
5. **No backups.** Explicitly out of scope, and mostly fine — Supabase owns the
   durable state and has its own backup story, and Redis holds nothing durable.
   The exception that used to be named here — `bp-certbot-certs`, whose loss
   cost a re-issuance against Let's Encrypt's rate limit — no longer exists.
   Nothing on this host is now expensive to lose.
6. **No CI.** Every quality gate is a human running commands. The image-build
   story here (build on the box) is a direct consequence and the first thing
   that should change when CI appears.
7. **A `directUrl` in `prisma/schema.prisma` would make the two-URL split
   explicit.** It is *not required* — `prisma.config.ts` reads
   `process.env.DATABASE_URL`, so `bp-migrate.service` overriding that variable
   for one container run is enough. But the split currently lives only in a
   systemd unit comment, where a future reader of the schema will not find it.
   That would be a `prisma-dev` change.

---

## What was not verified

Stated plainly, because none of it can be tested from a workstation and several
items are the kind that look fine until they are not.

- **Nothing here has run.** Podman is not installed on the machine this was
  written on. No unit was loaded, no image built, no container started.
- **Quadlet syntax is unvalidated.** Every key was written against the Quadlet
  documentation, but a typo in a key name is silently ignored by the generator
  rather than reported. First check on the host:
  `/usr/lib/systemd/system-generators/podman-system-generator --user --dryrun`
  (or `systemctl --user list-unit-files 'bp-*'` after `daemon-reload`).
- **The api-gateway healthcheck URL** (`GET /graphql?query={hello}`) has not been
  exercised against a running Mercurius. It is cosmetic if wrong — no
  `HealthOnFailure` action is set — but it will report a false "unhealthy".
- **Source-IP preservation through the rootless port forwarder** — the item that
  decides whether the nginx per-IP rate limit is real or a single shared bucket.
  See "Rootless Podman", point 3.
- **Supabase TLS chain trust**, and therefore whether `sslmode=verify-full` works
  without mounting a CA bundle.
- **The `pgbouncer=true` reasoning** is derived from reading
  `prisma.service.ts` and `prisma.config.ts`, not from running against a real
  transaction pooler.
- **Resource limits** are estimates. None were profiled.
- **Image sizes** were not measured; no image was built.
- **The stack does not "work".** It has never been up. The first run on EC2 is
  the first real test, and the deploy guide's smoke checks are what tells you.
