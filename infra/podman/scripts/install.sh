#!/usr/bin/env bash
# infra/podman/scripts/install.sh
#
# Installs the Quadlet units and bp-migrate.service into the CURRENT user's
# systemd, for a rootless Podman deploy. Run it as the deploy user, not as root.
#
# Idempotent: re-run it after any edit to infra/podman/quadlet/ to pick the
# change up. It copies rather than symlinks, because Quadlet's generator runs
# early in the systemd startup sequence and a symlink into a repo checkout on a
# separate filesystem is a needless way to make boot depend on a mount.
#
# What it does NOT do: create secrets, write /etc/bp-monitor/bp-monitor.env,
# issue certificates, or start anything. Those are separate, deliberate steps —
# see docs/guides/deploy.md.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
QUADLET_SRC="$REPO_ROOT/infra/podman/quadlet"
SYSTEMD_SRC="$REPO_ROOT/infra/podman/systemd"

QUADLET_DST="${XDG_CONFIG_HOME:-$HOME/.config}/containers/systemd"
UNIT_DST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

if [ "$(id -u)" = "0" ]; then
  echo "!!! Running as root installs this as a ROOTFUL deploy, which is not what"
  echo "!!! these units were written for (see 'Rootless Podman' in the README:"
  echo "!!! the port story, the SELinux :z flags and the linger requirement all"
  echo "!!! assume rootless). Re-run as the deploy user."
  exit 1
fi

if ! command -v podman >/dev/null 2>&1; then
  echo "podman not found on PATH." >&2
  exit 1
fi

echo ">>> podman version: $(podman --version)"
echo ">>> Quadlet units are a Podman 4.4+ feature; these were written against 5.x."
echo ">>> If 'systemctl --user list-unit-files bp-*' comes back empty after this"
echo ">>> script, your podman is too old or /usr/lib/systemd/user-generators/"
echo ">>> podman-user-generator is missing."

mkdir -p "$QUADLET_DST" "$UNIT_DST"

echo ">>> Installing Quadlet units -> $QUADLET_DST"
install -m 0644 "$QUADLET_SRC"/*.network "$QUADLET_DST/"
install -m 0644 "$QUADLET_SRC"/*.volume  "$QUADLET_DST/"
install -m 0644 "$QUADLET_SRC"/*.container "$QUADLET_DST/"
install -m 0644 "$QUADLET_SRC"/bp-monitor.target "$UNIT_DST/"

echo ">>> Installing bp-migrate.service -> $UNIT_DST"
install -m 0644 "$SYSTEMD_SRC/bp-migrate.service" "$UNIT_DST/"

echo ">>> Reloading the user systemd manager"
systemctl --user daemon-reload

echo
echo ">>> Generated units:"
systemctl --user list-unit-files 'bp-*' --no-pager || true

cat <<'NEXT'

Remaining host setup, none of which this script does for you:

  1. Unprivileged low ports (required — nginx binds 80 and 443 rootless):
       echo 'net.ipv4.ip_unprivileged_port_start=80' \
         | sudo tee /etc/sysctl.d/99-bp-monitor-ports.conf
       sudo sysctl --system
     Verify:  sysctl net.ipv4.ip_unprivileged_port_start   # -> 80

  2. Keep the user manager alive across logout (required — without this the
     whole stack stops when your SSH session ends):
       sudo loginctl enable-linger "$USER"
     Verify:  loginctl show-user "$USER" -p Linger         # -> Linger=yes

  3. Configuration and secrets:
       /etc/bp-monitor/bp-monitor.env   (from infra/podman/bp-monitor.env.example)
       podman secret create ...          (five secrets — see the README)

  4. Enable at boot, once you are happy:
       systemctl --user enable bp-monitor.target

Full sequence: docs/guides/deploy.md
NEXT
