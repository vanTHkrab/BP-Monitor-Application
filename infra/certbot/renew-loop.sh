#!/bin/sh
# infra/certbot/renew-loop.sh
#
# Long-running renew loop for the `certbot` compose service. This assumes a
# certificate already exists on the shared certbot_certs volume — it does
# NOT perform first-time issuance (see infra/scripts/init-letsencrypt.sh for
# that; nginx can't start without a cert file to begin with, so the very
# first issuance has to happen out-of-band before this loop is useful).
#
# `certbot renew` is a no-op for any certificate that isn't within its
# renewal window, so running it every 12h is the standard, documented
# certbot pattern — not a busy loop.
#
# POSIX sh on purpose — this runs inside certbot/certbot (no guaranteed bash).

set -eu

trap 'exit 0' TERM INT

while true; do
    certbot renew --quiet
    sleep 12h
done
