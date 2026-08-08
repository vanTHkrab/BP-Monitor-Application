#!/usr/bin/env bash
# infra/podman/scripts/build-images.sh
#
# Builds the three application images on the EC2 host with Podman and tags each
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
#   ./infra/podman/scripts/build-images.sh              # all three
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

# The api-gateway build context has no .dockerignore, so `COPY . .` sweeps in
# whatever is sitting in that directory — including a developer's .env if the
# checkout was ever used for local work. dotenv does not override variables
# already present in the process environment, so it will not change runtime
# behaviour, but it does bake a credential into an image layer. Refuse rather
# than warn: an image is a thing that gets copied around.
if [ -f server/app/api-gateway/.env ]; then
  echo "!!! server/app/api-gateway/.env exists and WILL be copied into the image."
  echo "!!! The api-gateway Dockerfile does 'COPY . .' with no .dockerignore."
  echo "!!! Remove or move it before building, or add a .dockerignore (see the"
  echo "!!! follow-ups in infra/podman/README.md)."
  exit 1
fi

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
      # Context is the REPOSITORY ROOT, not web/ — the docs site prerenders
      # docs/**/*.md and a context rooted at web/ cannot reach a sibling. The
      # root .dockerignore keeps that widened context down to web/ + docs/.
      podman build \
        --target prod \
        -t "$PREFIX/web:$TAG" \
        -t "$PREFIX/web:latest" \
        -f web/Dockerfile \
        .
      ;;
    *)
      echo "unknown image: $1 (expected api-gateway | ai-service | web)" >&2
      exit 2
      ;;
  esac
}

if [ "$#" -gt 0 ]; then
  for image in "$@"; do build_one "$image"; done
else
  build_one api-gateway
  build_one ai-service
  build_one web
fi

echo
echo ">>> Built:"
podman images --filter "reference=$PREFIX/*" \
  --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'
echo
echo ">>> Set BP_IMAGE_TAG=$TAG in /etc/bp-monitor/bp-monitor.env before running"
echo ">>> bp-migrate.service, so the migration runs from this same build."
