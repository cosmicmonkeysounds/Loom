#!/usr/bin/env bash
# Headless tests for the addon's scene layer (LoomStory, LoomHook,
# LoomTrigger, LoomTypewriter, the importer round-trip). The VM itself is
# covered by conformance.sh.
#
#   ./test/addon.sh [path-to-godot]

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project="$(dirname "$here")"

godot="${1:-}"
if [[ -z "$godot" ]]; then
  if command -v godot >/dev/null 2>&1; then
    godot="godot"
  elif [[ -x "/Applications/Godot.app/Contents/MacOS/Godot" ]]; then
    godot="/Applications/Godot.app/Contents/MacOS/Godot"
  else
    echo "addon: no godot binary found; pass one as \$1" >&2
    exit 2
  fi
fi

# Always refresh the import: new `class_name` scripts register through the
# global class cache, and a stale cache fails the run confusingly.
"$godot" --headless --path "$project" --import >/dev/null 2>&1 || true

"$godot" --headless --path "$project" --script res://test/addon.gd
