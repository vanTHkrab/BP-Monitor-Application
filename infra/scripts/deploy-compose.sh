#!/usr/bin/env bash
# infra/scripts/deploy-compose.sh
#
# Deploy a specific commit of the Docker Compose prod stack on the EC2 host.
#
# Invoked by .github/workflows/deploy-server.yml through AWS SSM. It lives in
# the repo rather than inline in the workflow on purpose: the deploy steps are
# then version-controlled, reviewable in a PR, and runnable by hand during an
# incident with the same behaviour CI gets.
#
#   sudo /opt/bp-monitor/infra/scripts/deploy-compose.sh <git-sha>
#
# ── What this does NOT do: migrations ───────────────────────────────────────
# `prisma migrate deploy` is deliberately absent, and adding it here would be a
# decision, not a convenience. Nothing else in this repo mutates the production
# schema automatically — infra/podman/systemd/bp-migrate.service is a manual
# `Type=oneshot` gate for the same reason, and its header explains it at
# length: a container with a restart policy plus migrate-on-boot turns a crash
# loop into repeated schema mutation attempts against live patient data.
#
# So a deploy that ships a migration is two steps, in this order:
#
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
#     run --rm api-gateway pnpm prisma migrate deploy      # you, by hand
#   <this script, via the workflow>                         # then the code
#
# Additive schema first, code second. There are no down-migrations here, so
# "roll back the code" must always be safe against the new schema.

set -euo pipefail

REPO_DIR="${BP_REPO_DIR:-/opt/bp-monitor}"
COMPOSE_DIR="$REPO_DIR/infra/docker-compose"
TARGET_SHA="${1:-}"

if [ -z "$TARGET_SHA" ]; then
    echo "!!! usage: $0 <git-sha>" >&2
    echo "!!! Deploying 'whatever main happens to be' makes the deployed" >&2
    echo "!!! commit unknowable after the fact. The SHA is required." >&2
    exit 2
fi

cd "$REPO_DIR"

# A dirty tree means someone edited files on the box. `git reset --hard` below
# would silently destroy that work, and an unexplained local edit is more often
# an in-progress incident fix than a mistake. Stop and let a human decide.
#
# Ignored files are not "dirty": infra/docker-compose/.env and
# infra/nginx/auth/.htpasswd both live here, are both gitignored, and must
# survive every deploy. `git status --porcelain` excludes them by default.
if [ -n "$(git status --porcelain)" ]; then
    echo "!!! Working tree at $REPO_DIR is dirty. Refusing to deploy." >&2
    git status --short >&2
    exit 1
fi

echo ">>> Fetching $TARGET_SHA"
git fetch --quiet origin main

# Checked out as an exact SHA rather than `git pull`, so the running code is
# the commit the workflow was triggered by — not whatever main advanced to
# while the build was queued.
if ! git cat-file -e "${TARGET_SHA}^{commit}" 2>/dev/null; then
    echo "!!! $TARGET_SHA is not a commit reachable from origin/main." >&2
    exit 1
fi

echo ">>> Checking out $TARGET_SHA"
git checkout --quiet --force -B main "$TARGET_SHA"
git --no-pager log --oneline -1

cd "$COMPOSE_DIR"

if [ ! -f .env ]; then
    echo "!!! $COMPOSE_DIR/.env is missing. It is gitignored and host-owned;" >&2
    echo "!!! create it from .env.example before the first deploy." >&2
    exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

echo ">>> Building images"
"${COMPOSE[@]}" build

# --remove-orphans is load-bearing on any host that ran an older revision of
# this stack: `web` and `certbot` were services here and are not any more.
# Without it their containers keep running against a config that no longer
# describes them — in certbot's case, renewing a certificate nothing serves.
echo ">>> Recreating containers"
"${COMPOSE[@]}" up -d --remove-orphans

echo
"${COMPOSE[@]}" ps

# nginx resolves `proxy_pass http://api-gateway:3000` once, at config load. A
# recreated gateway can land on a different address, and nginx will keep
# proxying to the old one until something makes it re-resolve. cloudflared
# caches nginx's address for the life of a connection and has the same problem
# one layer out. Both self-heal eventually; this makes it immediate.
echo
echo ">>> Bouncing nginx, then the tunnel, so both re-resolve"
"${COMPOSE[@]}" restart nginx
"${COMPOSE[@]}" restart cloudflared

# Proves three things at once: nginx rendered its template (rather than serving
# the image's stock default.conf), it still resolves api-gateway on bp-net, and
# the gateway answers GraphQL. A failure here is a failed deploy — the workflow
# reads this exit code.
echo
echo ">>> Smoke check through the proxy"
"${COMPOSE[@]}" exec -T nginx \
    wget -qO- 'http://127.0.0.1/graphql?query=%7Bhello%7D'
echo

echo ">>> Deployed $TARGET_SHA"
