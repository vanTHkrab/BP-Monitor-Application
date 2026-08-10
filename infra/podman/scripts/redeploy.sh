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
#   podman tag localhost/bp-monitor/ai-service:<old-sha>  localhost/bp-monitor/ai-service:latest
#   systemctl --user restart bp-api-gateway bp-ai-service bp-nginx bp-cloudflared
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

echo ">>> Restarting nginx so it re-resolves the new container addresses"
systemctl --user restart bp-nginx.service

# cloudflared caches the resolved address of its origin (`nginx` on bp-net) for
# the life of a connection, so the restart above can leave the tunnel pointing
# at an address that no longer exists — 502 at the edge while every container
# reports healthy. Bouncing the connector re-resolves it. It reconnects to
# Cloudflare in a few seconds; requests in that window fail at the edge rather
# than hanging, which is the loud failure mode.
echo ">>> Restarting the tunnel connector so it re-resolves nginx"
systemctl --user restart bp-cloudflared.service

echo
systemctl --user --no-pager status 'bp-*.service' --lines=0 || true

cat <<'SMOKE'

>>> Smoke-check from OUTSIDE the host. This matters more than it used to:
>>> nothing on this box listens on a public port any more, so a check run here
>>> proves only that the containers talk to each other. It cannot tell you the
>>> tunnel is up.

  curl -sS https://$DOMAIN_NAME/graphql \
    -H 'content-type: application/json' \
    -d '{"query":"{hello}"}'
  curl -sS -o /dev/null -w '%{http_code}\n' https://$DOMAIN_NAME/graphiql  # expect 401
  curl -sS https://$DOMAIN_NAME/.well-known/assetlinks.json                # passkeys

>>> And on the host, that the tunnel reconnected and ai-service came back:

  podman healthcheck run cloudflared && echo tunnel-ok
  journalctl --user -u bp-cloudflared.service -n 20 --no-pager  # "Registered tunnel connection"
  podman healthcheck run ai-service && echo ai-ok
  journalctl --user -u bp-ai-service.service -n 40 --no-pager
SMOKE
