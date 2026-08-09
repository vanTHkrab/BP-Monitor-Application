#!/bin/sh
# infra/nginx/reload-loop.sh
#
# Runs nginx in the foreground while periodically reloading its config in
# the background.
#
# This loop originally existed to pick up certbot's renewed certificates
# without certbot needing to signal this container. There is no certbot any
# more — TLS terminates at Cloudflare's edge and this server speaks plain HTTP
# on the internal network — but the loop is kept for the *other* thing it was
# always doing, which is the one that still bites:
#
#   nginx resolves `proxy_pass http://api-gateway:3000` ONCE, at config load.
#   If api-gateway is recreated and lands on a different address on bp-net,
#   nginx keeps proxying to the stale one and every request 502s until it
#   re-resolves.
#
# A 6h reload makes that self-heal within 6h. It does not make it fast: after
# a deliberate redeploy, restart nginx instead of waiting (redeploy.sh does
# this for you). The loop is the backstop for the recreates nobody triggered
# on purpose — an OOM kill, a crash restart.
#
# `nginx -s reload` is graceful and a no-op on existing connections when
# nothing changed, so reloading on a fixed interval costs nothing.
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
