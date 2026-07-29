#!/usr/bin/env bash
# Generate all PNG icon variants from SVG masters in assets/images/.
# Requires: rsvg-convert (apt install librsvg2-bin / brew install librsvg)
set -euo pipefail

cd "$(dirname "$0")/.."
SRC=assets/images
OUT=assets/images

if ! command -v rsvg-convert >/dev/null 2>&1; then
  echo "rsvg-convert not found. Install with:"
  echo "  Linux:  sudo apt install librsvg2-bin"
  echo "  macOS:  brew install librsvg"
  exit 1
fi

echo "→ icon.png (1024)"
rsvg-convert -w 1024 -h 1024 "$SRC/logo.svg" -o "$OUT/icon.png"

echo "→ splash-icon.png (1024, transparent rounded)"
rsvg-convert -w 1024 -h 1024 "$SRC/logo.svg" -o "$OUT/splash-icon.png"

echo "→ favicon.png (48)"
rsvg-convert -w 48 -h 48 "$SRC/logo.svg" -o "$OUT/favicon.png"

echo "→ android-icon-background.png (512)"
rsvg-convert -w 512 -h 512 "$SRC/logo-background.svg" -o "$OUT/android-icon-background.png"

echo "→ android-icon-foreground.png (512)"
rsvg-convert -w 512 -h 512 "$SRC/logo-foreground.svg" -o "$OUT/android-icon-foreground.png"

echo "→ android-icon-monochrome.png (432)"
rsvg-convert -w 432 -h 432 "$SRC/logo-monochrome.svg" -o "$OUT/android-icon-monochrome.png"

echo "Done. Files:"
ls -la "$OUT"/icon.png "$OUT"/splash-icon.png "$OUT"/favicon.png "$OUT"/android-icon-*.png
