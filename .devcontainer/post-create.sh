#!/usr/bin/env bash
# Bootstrap every sub-project on first container create.
#
# Eager install (~3–5 min first run; subsequent opens reuse cached volumes).
# The trade-off vs lazy install is named in .devcontainer/README.md.
#
# This script is idempotent — re-running it after a rebuild only refreshes
# whatever changed in each lockfile.

set -euo pipefail

WORKSPACE="${WORKSPACE:-/workspaces/BP-Monitor-Application}"
cd "${WORKSPACE}"

log() { printf '\n\033[1;36m[post-create]\033[0m %s\n' "$*"; }

# --- 1. pnpm via corepack ---------------------------------------------------
# Corepack is bundled with Node 22. We let it activate the latest pnpm so each
# package.json can pin its own `packageManager` field independently.
log "Enabling corepack + activating pnpm"
sudo corepack enable
corepack prepare pnpm@latest --activate
pnpm config set store-dir "${HOME}/.local/share/pnpm/store"

# --- 2. Fix mount ownership -------------------------------------------------
# Named volumes mounted by the devcontainer engine are owned by root before
# the `node` user touches them. Chown them once so pnpm/uv can write.
log "Reclaiming ownership of cache + node_modules volumes"
sudo chown -R "$(id -u):$(id -g)" \
  "${HOME}/.local/share/pnpm/store" \
  "${HOME}/.cache/uv" \
  "${WORKSPACE}/client/node_modules" \
  "${WORKSPACE}/web/node_modules" \
  "${WORKSPACE}/server/app/api-gateway/node_modules" \
  "${WORKSPACE}/server/app/ai-service/.venv" 2>/dev/null || true

# --- 3. Install Node sub-projects ------------------------------------------
# Each app has its own pnpm-lock.yaml (no workspaces) — install per-app from
# the app dir so the lockfile is the authority. `--frozen-lockfile` is safer
# but breaks when a dev intentionally bumps a dep before the lockfile is
# committed; use the default `install` here and let CI enforce frozen.
for app in client web server/app/api-gateway; do
  log "pnpm install in ${app}"
  pnpm --dir "${app}" install
done

# --- 4. Install ai-service via uv ------------------------------------------
# `uv sync` creates / updates .venv and installs from uv.lock.
log "uv sync in server/app/ai-service"
(cd "${WORKSPACE}/server/app/ai-service" && uv sync)

# --- 5. YOLO model integrity check -----------------------------------------
# The bundled YOLO must match SHA256 with the server copy. The check is
# normally `pnpm start`'s prestart hook on mobile; running it explicitly here
# surfaces drift on container open instead of at first `pnpm start`.
log "Verifying YOLO model SHA256 (client ↔ ai-service)"
pnpm --dir client verify-yolo-model || {
  printf '\n\033[1;33m[post-create]\033[0m YOLO model SHA256 drift detected.\n'
  printf '  Run: pnpm --dir client sync-yolo-model\n'
  printf '  Then commit both copies in the same change.\n\n'
}

# --- 6. Hint about secrets --------------------------------------------------
if [[ ! -f "${WORKSPACE}/infra/docker-compose/.env" ]]; then
  log "Reminder: copy infra/docker-compose/.env.example → .env before running compose"
fi

log "Bootstrap done. Read .devcontainer/README.md for run commands."
