#!/usr/bin/env bash
# N-08 bench check for the server-room box (hardware/server-room), run ON THE
# HOUSE MAC with the box powered on the bench: both MCP23017s on the bay,
# ring + DFPlayer connected. ~6 minutes. It only talks MQTT, so stagehand
# doesn't need to be running; HW-PATCH-07 (stagehand + the story) is
# scripts/accept/K-05.sh afterwards.
#
# Wave 20: the door moved to the Grand Central M4's LED + LDR sensor
# (hardware/server-room-door, its bench check is scripts/accept/N-20.sh).
# The box still publishes sensors/serverroom/door, but nothing listens (D16),
# so this check no longer tests the wire-loop contact.
#
#   scripts/accept/N-08.sh [/dev/cu.usbserial-XXXX]   # with a port: flash first
#
# Needs: mosquitto clients (brew install mosquitto), c++; to flash,
# hardware/server-room/server_room/secrets.h filled in + arduino-cli (or
# Arduino IDE 2) with the esp32 core.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HW="$ROOT/hardware/server-room"
CFG="$ROOT/stagehand/trapped.house.yaml"
HOST=$(awk '/^  mqtt:/{m=1} m&&/host:/{print $2; exit}' "$CFG")   # stagehand's listener (127.0.0.1)
BROKER=$(awk -F'"' '/^#define SR_BROKER_IP/{print $2}' "$HW/server_room/config.h")  # what the box dials (:1884)
TMP="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()   { echo "  ✔ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $*"; FAIL=$((FAIL+1)); }
step() { echo; echo "── $*"; }
ask()  { read -r -p "  → $* [enter] " _; }
yes()  { local a; read -r -p "  → $* [y/n] " a; [ "$a" = y ] || [ "$a" = Y ]; }
sub1() { mosquitto_sub -h "$HOST" -t "$1" -C 1 -W "${2:-10}" 2>/dev/null; }      # first message (retained ok)
pub()  { mosquitto_pub -h "$HOST" -t "$1" -m "$2"; }
watch() { mosquitto_sub -h "$HOST" -t "$1" > "$TMP/$2" 2>/dev/null & }             # background capture

step "0. preflight"
command -v mosquitto_sub >/dev/null && ok "mosquitto clients" || { bad "brew install mosquitto"; exit 1; }
"$HW/test/run.sh" >/dev/null 2>&1 && ok "host logic tests green" || bad "hardware/server-room/test/run.sh failing"
ifconfig | awk '/inet /{print $2}' | grep -qx "$BROKER" && ok "this Mac owns the box's broker address $BROKER" || bad "SR_BROKER_IP $BROKER is not this Mac's IP — fix the DHCP reservation or config.h"
mosquitto_pub -h "$HOST" -t n08/ping -m x 2>/dev/null && ok "Mosquitto answers on $HOST" || bad "Mosquitto not reachable on $HOST:1883"
if [ -n "${LOOM_MQTT_PASS:-}" ]; then   # the props password (secrets.h SR_MQTT_PASS)
  mosquitto_pub -h "$BROKER" -p 1884 -u props -P "$LOOM_MQTT_PASS" -t n08/ping -m x 2>/dev/null \
    && ok "props listener answers on $BROKER:1884" || bad "no props listener on $BROKER:1884 (scripts/house-mac/audio.md → Lock down the broker)"
else
  echo "  · set LOOM_MQTT_PASS=<props password> to also check $BROKER:1884"
fi

if [ -n "${1:-}" ]; then
  step "0b. flash"
  [ -f "$HW/server_room/secrets.h" ] || { bad "copy secrets.example.h to secrets.h and fill in the Wi-Fi first"; exit 1; }
  CLI="$(command -v arduino-cli || echo "/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli")"
  "$HW/test/run.sh" compile >/dev/null && "$CLI" upload -p "$1" --fqbn esp32:esp32:esp32 \
    --input-dir "${TMPDIR:-/tmp}/server-room-test/build" "$HW/server_room" && ok "flashed $1" || bad "flash failed"
fi

step "1. online + diagnostics"
H=$(sub1 health/serverroom 40)
[ "$H" = online ] && ok "health/serverroom = online" || bad "health/serverroom = '${H:-nothing in 40 s}' (Wi-Fi creds? static IP free? serial monitor at 115200)"
D=$(sub1 sensors/patchbay/diag 5); echo "    diag: $D"
echo "$D" | grep -q '"ok":true' && ok "both MCP23017s answer" || bad "patch bay not ok (0x20/0x21, SDA 21, SCL 22, power)"
echo "$D" | grep -q '"stuck":\[\]' && ok "no stuck jack" || bad "stuck jacks (terminated / shorted to the shell): fix the bay (README → The bay)"
echo "$D" | grep -q '"audio":true' && ok "DFPlayer answers" || bad "DFPlayer not answering (card in? TX via 1 kΩ to RX?)"

step "2. calibrate with every cord out"
ask "pull EVERY patch cord out, hands off the bay"
watch sensors/patchbay/diag diag; sleep 1
pub show/serverroom/calibrate empty; sleep 4
grep -q '"source":"mqtt"' "$TMP/diag" && ok "recalibrated" || bad "no recalibration diag (payload must contain 'empty')"
kill %% 2>/dev/null

step "3. the patch: Combo A in any order → one complete state, a click per cable"
A=$(grep -o "combo == 'V2[^']*'" "$CFG" | head -1 | cut -d"'" -f2)
watch sensors/patchbay/state state; sleep 1
ask "plug Combo A ($A) one cord at a time, ~2 s apart (relay should click + beep each time)"
sleep 2; kill %% 2>/dev/null
tail -1 "$TMP/state" | grep -q "\"combo\":\"$A\",\"count\":4,\"complete\":true" && ok "complete Combo A published" || bad "last state: $(tail -1 "$TMP/state")"
[ "$(grep -c . "$TMP/state")" -le 6 ] && ok "$(grep -c . "$TMP/state") state messages (one per held change)" || bad "too many state messages: $(grep -c . "$TMP/state")"
yes "did the relay click once per cable?" && ok "click" || bad "no click (GPIO25, 3.3 V-trigger relay)"
watch sensors/patchbay/state state2; sleep 1
ask "pull every cord out"
sleep 2; kill %% 2>/dev/null
tail -1 "$TMP/state2" | grep -q '"count":0' && ok "empty bay published (reset)" || bad "after unplugging: $(tail -1 "$TMP/state2")"

step "4. the ring + siren"
pub show/serverroom/lock '{"state": "locked"}'; yes "ring RED, breathing slowly?" && ok "locked" || bad "locked look"
pub show/serverroom/lock '{"state": "unlocked"}'; yes "ring solid GREEN?" && ok "unlocked" || bad "unlocked look"
pub show/serverroom/alarm '{"state": "on", "seconds": 8}'
yes "red STROBE + a ~3 s siren from the box's speaker?" && ok "alarm" || bad "alarm (siren = /mp3/0001.mp3 on the card)"
sleep 6; yes "strobe stopped by itself, ring back to green?" && ok "alarm ends on its own timer" || bad "alarm did not end"
pub show/serverroom/ring '{"mode": "white", "seconds": 3}'; sleep 4
yes "white for ~3 s, then green again?" && ok "ring override" || bad "ring override"
pub show/serverroom/lock '{"state": "locked"}'

step "5. power loss → LWT"
watch health/serverroom health; sleep 1
ask "UNPLUG the box's power, wait 20 s, plug it back in, wait for the ring"
sleep 15; kill %% 2>/dev/null
grep -q lost "$TMP/health" && ok "health went 'lost'" || bad "no LWT 'lost' (keepalive 10 s)"
tail -1 "$TMP/health" | grep -q online && ok "back online" || bad "did not come back online: $(tr '\n' ' ' < "$TMP/health")"
D=$(sub1 sensors/patchbay/diag 5)
echo "$D" | grep -q '"source":"stored"' && ok "baseline survived the reboot (stored)" || bad "baseline source after reboot: $D"
yes "ring red breathing again (retained lock re-applied)?" && ok "lock re-converged" || bad "lock not re-applied"

echo; echo "N-08: $PASS passed, $FAIL failed."
echo "Next: scripts/accept/K-05.sh (HW-PATCH-07: each combo fires its ending once through stagehand)."
[ "$FAIL" = 0 ]
