#!/usr/bin/env bash
# infra/scripts/init-letsencrypt.sh
#
# One-time bootstrap that issues the FIRST Let's Encrypt certificate for
# DOMAIN_NAME on a fresh host. Run this once, after DNS is pointed at the
# host, before relying on the prod stack's nginx/certbot services to serve
# real HTTPS traffic. See infra/README.md, section "First-time cert
# issuance", for the full walkthrough and prerequisites.
#
# Why this script exists at all: nginx's config always includes an HTTPS
# server block that points `ssl_certificate` at a Let's Encrypt path, but
# nginx refuses to start if that file doesn't exist yet — and certbot's
# webroot plugin needs a *running* nginx to serve the ACME HTTP-01
# challenge. Neither side can go first on its own, so this script breaks
# the cycle with a short-lived self-signed placeholder certificate.
#
# Safe to re-run: it no-ops (unless FORCE_RENEW=1) if a certificate for
# DOMAIN_NAME already exists on the certbot_certs volume.

set -euo pipefail

cd "$(dirname "$0")/../docker-compose"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${DOMAIN_NAME:?Set DOMAIN_NAME in infra/docker-compose/.env first (see .env.example)}"
: "${CERTBOT_EMAIL:?Set CERTBOT_EMAIL in infra/docker-compose/.env first (see .env.example)}"

RSA_KEY_SIZE=4096
STAGING_ARG=()
if [ "${CERTBOT_STAGING:-0}" = "1" ]; then
  STAGING_ARG=(--staging)
  echo ">>> CERTBOT_STAGING=1 — requesting from Let's Encrypt's staging CA"
  echo ">>> (cert will NOT be trusted by browsers; use this to test the flow"
  echo ">>> without burning the production CA's per-domain rate limit)."
fi

echo ">>> [1/5] Checking for an existing certificate for ${DOMAIN_NAME}..."
if "${COMPOSE[@]}" run --rm --entrypoint "/bin/sh" certbot -c \
  "test -f /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem"; then
  if [ "${FORCE_RENEW:-0}" != "1" ]; then
    echo ">>> A certificate for ${DOMAIN_NAME} already exists. Nothing to do."
    echo ">>> Set FORCE_RENEW=1 to force reissuance from scratch."
    exit 0
  fi
  echo ">>> FORCE_RENEW=1 set — continuing with reissuance."
fi

echo ">>> [2/5] Creating a temporary self-signed certificate so nginx can start..."
"${COMPOSE[@]}" run --rm --entrypoint "/bin/sh" certbot -c "
  mkdir -p /etc/letsencrypt/live/${DOMAIN_NAME} &&
  openssl req -x509 -nodes -newkey rsa:${RSA_KEY_SIZE} -days 1 \
    -keyout /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem \
    -out /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem \
    -subj '/CN=${DOMAIN_NAME}'
"

echo ">>> [3/5] Starting nginx with the temporary certificate..."
"${COMPOSE[@]}" up -d nginx

echo ">>> [4/5] Deleting the temporary certificate and requesting the real one..."
"${COMPOSE[@]}" run --rm --entrypoint "/bin/sh" certbot -c "
  rm -rf /etc/letsencrypt/live/${DOMAIN_NAME} \
         /etc/letsencrypt/archive/${DOMAIN_NAME} \
         /etc/letsencrypt/renewal/${DOMAIN_NAME}.conf
"
"${COMPOSE[@]}" run --rm --entrypoint "certbot" certbot certonly \
  --webroot -w /var/www/certbot \
  "${STAGING_ARG[@]}" \
  --email "${CERTBOT_EMAIL}" \
  -d "${DOMAIN_NAME}" \
  --rsa-key-size "${RSA_KEY_SIZE}" \
  --agree-tos \
  --no-eff-email

echo ">>> [5/5] Reloading nginx to pick up the real certificate..."
"${COMPOSE[@]}" exec nginx nginx -s reload

echo ">>> Done. https://${DOMAIN_NAME} is now served with a Let's Encrypt certificate."
echo ">>> The long-running 'certbot' service will keep renewing it automatically"
echo ">>> (renew check every 12h); 'nginx' reloads its config/certs every 6h so a"
echo ">>> renewed cert is picked up without manual intervention."
