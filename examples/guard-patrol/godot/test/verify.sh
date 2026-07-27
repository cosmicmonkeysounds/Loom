#!/usr/bin/env bash
# Headless verification of the integrated project. Pass a Godot binary as
# $1, or have `godot` on PATH, or the macOS app installed.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
project="$here/.."

godot="${1:-}"
if [[ -z "$godot" ]]; then
  if command -v godot >/dev/null 2>&1; then
    godot="godot"
  elif [[ -x "/Applications/Godot.app/Contents/MacOS/Godot" ]]; then
    godot="/Applications/Godot.app/Contents/MacOS/Godot"
  else
    echo "no godot binary found (pass one as \$1)" >&2
    exit 2
  fi
fi

# First import registers the class_name globals + imports the bank.
"$godot" --headless --path "$project" --import >/dev/null 2>&1 || true
exec "$godot" --headless --path "$project" --script res://test/verify.gd
