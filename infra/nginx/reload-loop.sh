#!/bin/sh
# infra/nginx/reload-loop.sh
#
# Mounted at /docker-entrypoint.d/99-reload-loop.sh, NOT at /usr/local/bin.
# That location is load-bearing — read the next paragraph before moving it.
#
# ── Why this is not the container's command ─────────────────────────────────
# The nginx image's /docker-entrypoint.sh renders /etc/nginx/templates/*.template
# through envsubst into /etc/nginx/conf.d/ — but only when the command it is
# handed starts with `nginx`:
#
#     if [ "$1" = "nginx" ] || [ "$1" = "nginx-debug" ]; then
#         ... run /docker-entrypoint.d/* ...
#     fi
#     exec "$@"
#
# This script used to BE the command (`command: ["/bin/sh", "reload-loop.sh"]`,
# `Exec=/bin/sh ...`). `$1` was `/bin/sh`, so that branch never ran, the
# template was never rendered, and nginx started on the image's stock
# default.conf instead. The symptom is unmistakable once you know it: the
# domain serves "Welcome to nginx!" and every real route — /graphql included —
# returns 404, while `docker compose ps` shows a healthy container and
# `nginx -t` passes on the template you are reading.
#
# So the container now runs its default command (`nginx -g "daemon off;"`),
# the entrypoint renders the template, and this script is one of the hooks the
# entrypoint runs on the way. It must be executable, or the entrypoint logs
# "Ignoring ..., not executable" and skips it silently. It must also RETURN
# rather than block, so the entrypoint can go on to exec nginx — hence the
# background subshell and the absence of any `exec` here.
#
# The `99-` prefix orders it after 20-envsubst-on-templates.sh. Nothing here
# depends on that today, but a reload before the config is rendered would be
# meaningless.
#
# ── What the loop is actually for ───────────────────────────────────────────
# It originally existed to pick up certbot's renewed certificates without
# certbot needing to signal this container. There is no certbot any more — TLS
# terminates at Cloudflare's edge — but the loop is kept for the other thing it
# was always doing, which is the one that still bites:
#
#   nginx resolves `proxy_pass http://api-gateway:3000` ONCE, at config load.
#   If api-gateway is recreated and lands on a different address on bp-net,
#   nginx keeps proxying to the stale one and every request 502s.
#
# A 6h reload makes that self-heal within 6h. It does not make it fast: after a
# deliberate redeploy, restart nginx instead of waiting (redeploy.sh does this
# for you). The loop is the backstop for the recreates nobody triggered on
# purpose — an OOM kill, a crash restart.
#
# `nginx -s reload` is graceful and a no-op on existing connections when
# nothing changed, so reloading on a fixed interval costs nothing.
#
# POSIX sh on purpose — this runs inside nginx:*-alpine (no bash).

set -e

# Background, and return immediately. The subshell outlives this script and is
# reparented when the entrypoint execs nginx.
(
    while true; do
        sleep 6h
        nginx -s reload || true
    done
) &
