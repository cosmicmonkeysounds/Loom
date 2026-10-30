#!/usr/bin/env bash
# The door sensor's checks.
#
#   test/run.sh            host tests of the pure logic (c++17 only)
#   test/run.sh compile    + compile the sketch for the Grand Central M4 (arduino-cli)
#
# arduino-cli: on PATH, or the copy inside Arduino IDE 2. The Adafruit SAMD
# core and the two libraries (FlashStorage_SAMD, Adafruit NeoPixel) are
# installed on first run into your normal Arduino directories unless
# ARDUINO_DIRECTORIES_USER / ARDUINO_DIRECTORIES_DATA point elsewhere.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/server-room-m4-test"
mkdir -p "$OUT"

# test/shim/ stands in for FlashStorage_SAMD.h, so store.h's flash code runs here.
c++ -std=c++17 -Wall -Wextra -Werror -I "$HERE/test/shim" -o "$OUT/test_logic" "$HERE/test/test_logic.cpp"
"$OUT/test_logic" "$HERE/test/fixtures/lines.jsonl"

[ "${1:-}" = "compile" ] || exit 0

CLI="$(command -v arduino-cli || true)"
[ -n "$CLI" ] || CLI="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
[ -x "$CLI" ] || { echo "arduino-cli not found (brew install arduino-cli, or install Arduino IDE 2)"; exit 2; }
FQBN="${FQBN:-adafruit:samd:adafruit_grandcentral_m4}"
INDEX="https://adafruit.github.io/arduino-board-index/package_adafruit_index.json"
if ! "$CLI" core list 2>/dev/null | grep -q '^adafruit:samd'; then
  "$CLI" config add board_manager.additional_urls "$INDEX" 2>/dev/null || true
  "$CLI" core update-index --additional-urls "$INDEX"
  "$CLI" core install adafruit:samd --additional-urls "$INDEX"
fi
for lib in FlashStorage_SAMD "Adafruit NeoPixel"; do
  "$CLI" lib list "$lib" 2>/dev/null | grep -qi "^${lib// /.}" || "$CLI" lib install "$lib"
done
"$CLI" compile --fqbn "$FQBN" --warnings default --build-path "$OUT/build" "$HERE/server_room_m4"
# The other wiring's build (the LED on 5V, always lit): config.h's LED_MODE.
"$CLI" compile --fqbn "$FQBN" --warnings default --build-path "$OUT/build-steady" --clean \
  --build-property "compiler.cpp.extra_flags=-DLED_MODE=LED_STEADY" "$HERE/server_room_m4" >/dev/null
echo "steady build: ok"
