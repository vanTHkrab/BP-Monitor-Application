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
│   ├── docker-compose.prod.yml     # override: build target=prod, restart policy
│   └── .env.example                # copy to .env, fill in real values
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

### Prod (built images, restart policy, DB/Redis not exposed)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### Other / custom environments

Create another override file (e.g. `docker-compose.staging.yml`) and chain it
the same way:

```bash
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

## Env vars

All connection strings live in `.env`. `DATABASE_URL` is consumed by Prisma in
api-gateway; host **must** be `postgres` (the compose service name) inside the
compose network. Redis uses `REDIS_HOST=redis` for the same reason.

Never commit a real `.env` — only `.env.example` is tracked.

## Notes

- Each app owns its `Dockerfile` (multi-stage with `dev` + `prod` targets).
  Compose picks the target via the override files.
- The mobile **client** is intentionally absent from compose — run it with
  `pnpm --dir client start`.
