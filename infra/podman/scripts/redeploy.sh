#!/usr/bin/env bash
# infra/podman/scripts/redeploy.sh
#
# Redeploy the running stack from the current checkout: rebuild the images,
# restart the units in dependency order, and bounce nginx last.
#
# Does NOT run migrations. If this deploy ships a Prisma migration, run it
# yourself, before this script, and read the output:
#   systemctl --user start bp-migrate.service
#   journalctl --user -u bp-migrate.service -n 100 --no-pager
# See infra/podman/systemd/bp-migrate.service for why that is a manual gate.
#
# ── Why nginx is restarted last, always ─────────────────────────────────────
# nginx resolves `proxy_pass http://api-gateway:3000` once, at config load. When
# api-gateway is recreated it can land on a different address on bp-net, and
# nginx will keep proxying to the old one — every request 502s until something
# makes nginx re-resolve. The 6h reload loop eventually does; this script does
# it immediately.
#
# ── Rollback ────────────────────────────────────────────────────────────────
# Images are tagged with the git SHA as well as `latest`, so rolling back is
# retagging and restarting — no rebuild:
#   podman tag localhost/bp-monitor/api-gateway:<old-sha> localhost/bp-monitor/api-gateway:latest
#   podman tag localhost/bp-monitor/web:<old-sha>         localhost/bp-monitor/web:latest
#   podman tag localhost/bp-monitor/ai-service:<old-sha>  localhost/bp-monitor/ai-service:latest
#   systemctl --user restart bp-api-gateway bp-web bp-ai-service bp-nginx
# A schema migration is NOT rolled back by this. Prisma has no down-migrations
# here, which is exactly why the deploy ordering is additive-schema first, code
# second, and drops in a later separate change.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

echo ">>> Building images"
"$REPO_ROOT/infra/podman/scripts/build-images.sh" "$@"

echo
echo ">>> Restarting application units"
# Redis is deliberately not restarted: it is the pub/sub transport and the
# rate-limit store, and bouncing it drops in-flight analyze_bp_image jobs for
# no reason on an app-only deploy.
systemctl --user restart bp-api-gateway.service
systemctl --user restart bp-ai-service.service
systemctl --user restart bp-web.service

echo ">>> Restarting nginx so it re-resolves the new container addresses"
systemctl --user restart bp-nginx.service

echo
systemctl --user --no-pager status 'bp-*.service' --lines=0 || true

cat <<'SMOKE'

>>> Smoke-check from OUTSIDE the host (a check run on the box proves less —
>>> it skips DNS, the security group, and TLS as a client sees it):

  curl -sS -o /dev/null -w '%{http_code}\n' https://$DOMAIN_NAME/
  curl -sS https://$DOMAIN_NAME/graphql \
    -H 'content-type: application/json' \
    -d '{"query":"{hello}"}'
  curl -sS -o /dev/null -w '%{http_code}\n' https://$DOMAIN_NAME/admin/   # expect 401

>>> And on the host, that ai-service actually came back:

  podman healthcheck run ai-service && echo ok
  journalctl --user -u bp-ai-service.service -n 40 --no-pager
SMOKE
