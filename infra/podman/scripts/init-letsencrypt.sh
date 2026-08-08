#!/usr/bin/env bash
# infra/podman/scripts/init-letsencrypt.sh
#
# One-time bootstrap that issues the FIRST Let's Encrypt certificate for
# $DOMAIN_NAME on a fresh EC2 host, for the Podman runtime.
#
# This is the Podman counterpart of infra/scripts/init-letsencrypt.sh (which
# drives the Compose stack). The logic is the same and the reason it has to
# exist is the same: nginx's config points ssl_certificate at a Let's Encrypt
# path and refuses to start if the file is missing, while certbot's webroot
# plugin needs a RUNNING nginx to serve the ACME HTTP-01 challenge. Neither can
# go first, so this breaks the cycle with a one-day self-signed placeholder.
#
# Prerequisites, all of which fail confusingly if skipped:
#   - DNS A (and AAAA, if the instance has IPv6) for $DOMAIN_NAME resolves to
#     this instance's public / Elastic IP.
#   - Security group allows INBOUND tcp/80 and tcp/443 from 0.0.0.0/0. Port 80
#     is not optional: it carries the ACME challenge, for issuance and for
#     every renewal thereafter.
#   - /etc/bp-monitor/bp-monitor.env exists with DOMAIN_NAME and CERTBOT_EMAIL.
#   - install.sh has been run, so bp-nginx.service and the certbot volumes exist.
#
# Safe to re-run: no-ops if a certificate for $DOMAIN_NAME already exists,
# unless FORCE_RENEW=1.

set -euo pipefail

ENV_FILE="${BP_ENV_FILE:-/etc/bp-monitor/bp-monitor.env}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
else
  echo "!!! $ENV_FILE not found. Copy infra/podman/bp-monitor.env.example there first." >&2
  exit 1
fi

: "${DOMAIN_NAME:?Set DOMAIN_NAME in $ENV_FILE}"
: "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL in $ENV_FILE}"

CERTBOT_IMAGE="docker.io/certbot/certbot:latest"
CERTS_VOL="bp-certbot-certs"
WWW_VOL="bp-certbot-www"
RSA_KEY_SIZE=4096

STAGING_ARG=()
if [ "${CERTBOT_STAGING:-0}" = "1" ]; then
  STAGING_ARG=(--staging)
  echo ">>> CERTBOT_STAGING=1 — requesting from Let's Encrypt's STAGING CA."
  echo ">>> The resulting certificate will not be trusted by browsers. Use this"
  echo ">>> to prove DNS and the security group are right without burning the"
  echo ">>> production CA's per-domain rate limit, then re-run with 0."
fi

# The Quadlet .volume units are only materialised when a container that
# references them starts. Create them up front so this script can mount them
# before nginx has ever run.
podman volume exists "$CERTS_VOL" || podman volume create "$CERTS_VOL"
podman volume exists "$WWW_VOL"   || podman volume create "$WWW_VOL"

certbot_run() {
  podman run --rm \
    -v "$CERTS_VOL:/etc/letsencrypt" \
    -v "$WWW_VOL:/var/www/certbot" \
    "$@"
}

echo ">>> [1/5] Checking for an existing certificate for ${DOMAIN_NAME}..."
if certbot_run --entrypoint /bin/sh "$CERTBOT_IMAGE" -c \
     "test -f /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem"; then
  if [ "${FORCE_RENEW:-0}" != "1" ]; then
    echo ">>> A certificate for ${DOMAIN_NAME} already exists. Nothing to do."
    echo ">>> Set FORCE_RENEW=1 to force reissuance from scratch."
    exit 0
  fi
  echo ">>> FORCE_RENEW=1 — continuing with reissuance."
fi

echo ">>> [2/5] Creating a 1-day self-signed placeholder so nginx can bind 443..."
certbot_run --entrypoint /bin/sh "$CERTBOT_IMAGE" -c "
  mkdir -p /etc/letsencrypt/live/${DOMAIN_NAME} &&
  openssl req -x509 -nodes -newkey rsa:${RSA_KEY_SIZE} -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem \
    -subj '/CN=${DOMAIN_NAME}'
"

echo ">>> [3/5] Starting nginx with the placeholder..."
# Starting bp-nginx pulls in bp-api-gateway and bp-web via Requires=, which is
# fine — they are what you are about to run anyway. If they are not ready yet,
# start the whole target instead: systemctl --user start bp-monitor.target
systemctl --user start bp-nginx.service
sleep 3
systemctl --user is-active --quiet bp-nginx.service || {
  echo "!!! bp-nginx.service did not come up. Check:" >&2
  echo "!!!   journalctl --user -u bp-nginx.service -n 60 --no-pager" >&2
  echo "!!! A 'permission denied' bind on :80 means the unprivileged-port" >&2
  echo "!!! sysctl is missing — see install.sh step 1." >&2
  exit 1
}

echo ">>> [4/5] Removing the placeholder and requesting the real certificate..."
certbot_run --entrypoint /bin/sh "$CERTBOT_IMAGE" -c "
  rm -rf /etc/letsencrypt/live/${DOMAIN_NAME} \
         /etc/letsencrypt/archive/${DOMAIN_NAME} \
         /etc/letsencrypt/renewal/${DOMAIN_NAME}.conf
"
certbot_run "$CERTBOT_IMAGE" certonly \
  --webroot -w /var/www/certbot \
  "${STAGING_ARG[@]}" \
  --email "${CERTBOT_EMAIL}" \
  -d "${DOMAIN_NAME}" \
  --rsa-key-size "${RSA_KEY_SIZE}" \
  --agree-tos \
  --no-eff-email

echo ">>> [5/5] Reloading nginx to pick up the real certificate..."
podman exec nginx nginx -s reload

echo
echo ">>> Done. https://${DOMAIN_NAME} should now serve a Let's Encrypt certificate."
echo ">>> Renewal from here is automatic: bp-certbot checks every 12h, bp-nginx"
echo ">>> reloads every 6h so a renewed cert is picked up with no manual step."
echo ">>> Verify from OUTSIDE the host, not from it:"
echo ">>>   curl -sSI https://${DOMAIN_NAME}/ | head -1"
