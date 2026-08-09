#!/usr/bin/env bash
# infra/podman/scripts/build-images.sh
#
# Builds the two application images on the EC2 host with Podman and tags each
# one twice: with the current git short SHA and with `latest`.
#
# ── Why build on the box ────────────────────────────────────────────────────
# There is no CI in this repository (.github does not exist). That leaves two
# options and this script takes the first:
#
#   1. Build here. One machine, one toolchain, no artifact transport, and the
#      built image provably matches the checkout at /opt/bp-monitor. The cost is
#      paid in instance resources: the ai-service build resolves onnxruntime and
#      opencv-python-headless wheels (~250 MB of downloads, and the resulting
#      image is the largest in the stack), and the two Node builds each run a
#      full `pnpm install` plus a compile. On a t3.micro (1 GiB) this is a
#      coin-flip against the OOM killer. t3.small (2 GiB) with swap is the
#      realistic floor; t3.medium (4 GiB) builds without drama. Build time also
#      competes with serving traffic on a single-host deploy — build during a
#      quiet window, or accept the latency blip.
#
#   2. Build elsewhere, `podman save` a tarball, scp it, `podman load`. Keeps
#      the instance small, but the ai-service tarball is several hundred MB per
#      deploy over the wire and nothing verifies that the tarball came from the
#      commit you think it did. It is the right answer once a registry exists;
#      it is worse than option 1 while the transport is a human with scp.
#
# Revisit both the moment CI exists: build once in CI, push to a registry, and
# the host only ever pulls.
#
# Usage:
#   ./infra/podman/scripts/build-images.sh              # both
#   ./infra/podman/scripts/build-images.sh api-gateway  # just one

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

TAG="${BP_IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo manual)}"
PREFIX="localhost/bp-monitor"

echo ">>> Repo:  $REPO_ROOT"
echo ">>> Tag:   $TAG"
echo ">>> Commit: $(git rev-parse HEAD 2>/dev/null || echo 'not a git checkout')"

if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  echo "!!! WARNING: the working tree is dirty. The tag '$TAG' will NOT describe"
  echo "!!! what is in these images. Commit or stash before a real deploy."
fi

# Both service build contexts now carry their own .dockerignore
# (server/app/api-gateway/.dockerignore, server/app/ai-service/.dockerignore),
# which is what keeps `COPY . .` from sweeping in a developer's .env, a
# host-built node_modules / .venv, or the ~78 MB of model weights the
# ai-service image deliberately does not ship (ADR-005).
#
# This check is a tripwire on those files still existing, not a substitute for
# them. Deleting a .dockerignore is a one-line change that bakes a credential
# into an image layer and produces no error at build time — an image is a thing
# that gets copied around, so refuse rather than warn.
for ctx in server/app/api-gateway server/app/ai-service; do
  if [ ! -f "$ctx/.dockerignore" ]; then
    echo "!!! $ctx/.dockerignore is missing."
    echo "!!! Its Dockerfile does 'COPY . .', so building without it copies"
    echo "!!! that directory's .env, node_modules/.venv and any model weights"
    echo "!!! straight into the image. Restore it before building."
    exit 1
  fi
done

build_one() {
  case "$1" in
    api-gateway)
      podman build \
        --target prod \
        -t "$PREFIX/api-gateway:$TAG" \
        -t "$PREFIX/api-gateway:latest" \
        -f server/app/api-gateway/Dockerfile \
        server/app/api-gateway
      ;;
    ai-service)
      podman build \
        --target prod \
        -t "$PREFIX/ai-service:$TAG" \
        -t "$PREFIX/ai-service:latest" \
        -f server/app/ai-service/Dockerfile \
        server/app/ai-service
      ;;
    web)
      # `web` is not part of this deploy. It has no authentication of its own,
      # its /admin/ pages open direct connections to Postgres, Redis and S3,
      # and the only thing that ever guarded them was an nginx Basic Auth rule.
      # Run it locally against the datastores instead — see infra/README.md.
      echo "web is no longer deployed to production; build it locally instead." >&2
      echo "See infra/README.md, 'Running the dashboard against production'." >&2
      exit 2
      ;;
    *)
      echo "unknown image: $1 (expected api-gateway | ai-service)" >&2
      exit 2
      ;;
  esac
}

if [ "$#" -gt 0 ]; then
  for image in "$@"; do build_one "$image"; done
else
  build_one api-gateway
  build_one ai-service
fi

echo
echo ">>> Built:"
podman images --filter "reference=$PREFIX/*" \
  --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'
echo
echo ">>> Set BP_IMAGE_TAG=$TAG in /etc/bp-monitor/bp-monitor.env before running"
echo ">>> bp-migrate.service, so the migration runs from this same build."
