#!/usr/bin/env bash
# The server-room box's checks.
#
#   test/run.sh            host tests of the pure logic (c++ only)
#   test/run.sh compile    + compile the sketch for the ESP32 (arduino-cli)
#
# arduino-cli: on PATH, or the copy inside Arduino IDE 2. Libraries it needs
# are installed on first run (PubSubClient, Adafruit NeoPixel,
# DFRobotDFPlayerMini) into your normal sketchbook unless
# ARDUINO_DIRECTORIES_USER points elsewhere. The esp32 core must be installed
# (Boards Manager → esp32 by Espressif, 3.x).
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/server-room-test"
mkdir -p "$OUT"

c++ -std=c++17 -Wall -Wextra -Werror -o "$OUT/test_logic" "$HERE/test/test_logic.cpp"
"$OUT/test_logic"

[ "${1:-}" = "compile" ] || exit 0

CLI="$(command -v arduino-cli || true)"
[ -n "$CLI" ] || CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
[ -x "$CLI" ] || { echo "arduino-cli not found (brew install arduino-cli, or install Arduino IDE 2)"; exit 2; }
FQBN="${FQBN:-esp32:esp32:esp32}"
for lib in PubSubClient "Adafruit NeoPixel" DFRobotDFPlayerMini; do
  "$CLI" lib list "$lib" 2>/dev/null | grep -qi "^${lib// /.}" || "$CLI" lib install "$lib"
done
"$CLI" compile --fqbn "$FQBN" --warnings default --build-path "$OUT/build" "$HERE/server_room"
