#!/bin/sh
# infra/nginx/reload-loop.sh
#
# Runs nginx in the foreground while periodically reloading its config in
# the background. The `certbot` sidecar renews certificates independently
# and has no way to signal this container (deliberately — see the `nginx`
# service comment in docker-compose.prod.yml for why we didn't mount
# docker.sock to allow a `docker compose exec` signal instead). A reload on
# a fixed interval is the trade-off: `nginx -s reload` is graceful and a
# no-op on existing connections when the config/certs haven't changed, so
# reloading every 6h whether or not a renewal happened costs nothing.
#
# POSIX sh on purpose — this runs inside nginx:*-alpine (no bash).

set -eu

(
    while true; do
        sleep 6h
        nginx -s reload
    done
) &

exec nginx -g "daemon off;"
