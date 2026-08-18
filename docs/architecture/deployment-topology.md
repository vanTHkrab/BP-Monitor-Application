---
title: Deployment Topology
description: >-
    What actually runs where, in each of the three runtimes this repo defines:
    the dev Compose stack, the prod-shaped Compose rehearsal, and the Podman
    Quadlet units intended for the EC2 host. Includes the two facts most often
    got wrong — web/ is in no deployed stack, and ai-service publishes no port
    anywhere.
status: current
updated: 2026-08-16
owner: infra
---

## The three runtimes

Same images, three supervisors, and a deliberately shrinking surface as you
move right. The only ingress in the two right-hand columns is a Cloudflare
Tunnel connector, so **no host port is published to the internet at all**.

```mermaid
flowchart TB
    subgraph DEV["🧪 Dev — docker-compose.yml + .dev.yml"]
        direction TB
        DEV_WEB["web:3000<br/>Next.js dev server"]
        DEV_GW["api-gateway:3000<br/>pnpm start:dev, bind-mounted"]
        DEV_AI["ai-service:8000<br/>fastapi dev"]
        DEV_PG[("postgres:5432<br/>volume postgres_data")]
        DEV_RD[("redis:6379<br/>appendonly, volume redis_data")]
        DEV_WEB -. "direct pg / redis / s3 / http" .-> DEV_PG
        DEV_WEB -.-> DEV_RD
        DEV_GW --> DEV_PG
        DEV_GW --> DEV_RD
        DEV_AI --> DEV_RD
    end

    subgraph PROD["🎯 Prod-shaped rehearsal — + .prod.yml"]
        direction TB
        P_CF["cloudflared<br/>the only ingress, outbound-only"]
        P_NG["nginx :80 (expose, not publish)<br/>envsubst templates + 6 h reload loop<br/>Basic Auth on /graphiql"]
        P_GW["api-gateway :3000 (expose)<br/>build target: prod"]
        P_AI["ai-service<br/>NO port, NO nginx route"]
        P_PG[("postgres")]
        P_RD[("redis")]
        P_CF --> P_NG
        P_NG --> P_GW
        P_GW --> P_PG
        P_GW --> P_RD
        P_AI --> P_RD
        P_NOTE["web: not defined here —<br/>an override cannot remove a service,<br/>so it lives only in .dev.yml"]
    end

    subgraph QUADLET["🚀 Intended production — infra/podman/ Quadlet on EC2"]
        direction TB
        Q_CF["bp-cloudflared.container"]
        Q_NG["bp-nginx.container<br/>same config files, reused verbatim"]
        Q_GW["bp-api-gateway.container"]
        Q_AI["bp-ai-service.container"]
        Q_RD[("bp-redis.container<br/>+ bp-redis-data.volume")]
        Q_PG[("Supabase — off-box, managed")]
        Q_MIG["bp-migrate.service<br/>manual gate, Prisma migrations"]
        Q_CF --> Q_NG
        Q_NG --> Q_GW
        Q_GW --> Q_RD
        Q_GW --> Q_PG
        Q_AI --> Q_RD
        Q_MIG -.-> Q_PG
    end

    INTERNET(("Internet")) --> CFEDGE["Cloudflare edge<br/>TLS terminates here"]
    CFEDGE -. "tunnel, no inbound port" .-> P_CF
    CFEDGE -. "tunnel, no inbound port" .-> Q_CF
    S3EXT[("S3-compatible object storage<br/>external in every runtime")]
    P_GW --> S3EXT
    P_AI --> S3EXT
    Q_GW --> S3EXT
    Q_AI --> S3EXT
    DEV_GW --> S3EXT

    classDef dev fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef prod fill:#ede9fe,stroke:#7c3aed,color:#4c1d95
    classDef quad fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef note fill:#fef3c7,stroke:#d97706,color:#92400e
    class DEV_WEB,DEV_GW,DEV_AI,DEV_PG,DEV_RD dev
    class P_CF,P_NG,P_GW,P_AI,P_PG,P_RD prod
    class Q_CF,Q_NG,Q_GW,Q_AI,Q_RD,Q_PG,Q_MIG quad
    class P_NOTE note
```

## What the topology is defending against

- **No published port in the prod-shaped stack** — `api-gateway` uses `expose`,
  not `ports`. nginx is reachable only from `cloudflared` over `bp-net`, and
  `cloudflared` makes an outbound connection to Cloudflare. There is nothing to
  port-scan.
- **Point the tunnel at nginx, never at the gateway** — nginx owns the
  `/graphiql` Basic Auth gate and the per-IP flood guard on `/graphql`.
  Bypassing it removes both silently.
- **ai-service is unreachable from outside the network** — no published port,
  no nginx route. It used to publish `8000:8000`, which was a real
  internet-facing exposure of an internal service with no auth in front of it.
  Its only caller is api-gateway over Redis.
- **`web/` is not in any deployed stack** — it is defined in
  `docker-compose.dev.yml` only, because an override file can change a service
  but cannot remove one. It has no authentication of its own and its `/admin`
  pages read Postgres, Redis, and S3 directly; removing it from the deploy is
  the version of that decision that cannot regress when someone edits an nginx
  config.
- **The web build context is the repo root** — the docs site prerenders
  `docs/**/*.md` at build time, and a context rooted at `web/` cannot reach a
  sibling directory.
- **Migrations are a manual gate** — `bp-migrate.service` is a separate,
  operator-triggered unit. Nothing in the deploy path runs a migration for you.

## Where the documents disagree

Two statements in this repo cannot both be current:

- `infra/README.md` and `infra/podman/README.md` describe **Podman Quadlet on
  EC2 with Supabase** as production, and the Compose stacks as development and
  prod-parity staging.
- `infra/podman/README.md` also states plainly that **nothing in that directory
  has ever been executed** — no unit loaded, no image built, no EC2 host
  involved.

So the Quadlet column above is a reviewed design, not an observed runtime, and
whichever stack the live host is running today, the operational history sits
with the Compose files. Treat "production" in the podman docs as intent until
someone records a first successful run; if you are looking for what a running
box actually does, read the Compose prod overlay and
[docs/guides/deploy.md](../guides/deploy.md), and reconcile the two before
relying on either.
