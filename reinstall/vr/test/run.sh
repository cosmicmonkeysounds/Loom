#!/usr/bin/env bash
# Headless checks for the VR game: the §1.2 goldens (walls / routes /
# locate ports vs @loom/house), frames, duck, locomotion maths, config,
# the pose pump, the SSE parser, the lobby picker, the game state machine,
# and a smoke test that main.tscn builds the house.
#
#   ./test/run.sh [path-to-godot]

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
    echo "reinstall-vr: no godot binary found; pass one as \$1" >&2
    exit 2
  fi
fi

if [[ ! -f "$project/house/house.json" || ! -d "$project/test/golden" ]]; then
  echo "reinstall-vr: house/house.json or test/golden/ missing — run: pnpm --filter @loom/house sync" >&2
  exit 2
fi

# A script error leaves a headless SceneTree running forever; never wait
# more than this many seconds for one run.
watchdog() { perl -e 'alarm shift; exec @ARGV' "$@"; }

# Always refresh the import: new `class_name` scripts register through the
# global class cache, and a stale cache fails the run confusingly.
watchdog 180 "$godot" --headless --path "$project" --xr-mode off --import >/dev/null 2>&1 || true

# Every script compiles, every scene / shader loads.
watchdog 180 "$godot" --headless --path "$project" --xr-mode off --script res://test/check_scripts.gd

# --offline keeps the ServerLink autoload off the network.
watchdog 180 "$godot" --headless --path "$project" --xr-mode off --script res://test/game.gd -- --offline
