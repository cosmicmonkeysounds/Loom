#!/usr/bin/env bash
# K-05 bench acceptance (Thu 10-22), run ON THE HOUSE MAC with the real door
# (its standalone keypad lock + the wire-loop contact that closes when the
# door opens), the patch bay and the lights powered. ~10 minutes; it tells you when to touch
# what and checks stagehand's log + the MQTT traffic for you.
#
#   scripts/accept/K-05.sh [path/to/trapped.house.yaml]
#
# Needs: uv, mosquitto clients (brew install mosquitto), the `show` and
# `agents` launchd jobs installed (uv run stagehand launchd install …), and a
# live event on the VPS whose id + mod passcode are in the git-ignored
# trapped.house.local.yaml (or LOOM_EVENT_ID / LOOM_MOD_PASSCODE).
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SH="$ROOT/stagehand"
CFG="${1:-$SH/trapped.house.yaml}"
LOG="$HOME/Library/Logs/stagehand/show.log"
PASS=0; FAIL=0
ok()   { echo "  ✔ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $*"; FAIL=$((FAIL+1)); }
step() { echo; echo "── $*"; }
ask()  { read -r -p "  → $* [enter] " _; }
yes()  { local a; read -r -p "  → $* [y/n] " a; [ "$a" = y ] || [ "$a" = Y ]; }
lines() { [ -f "$LOG" ] && wc -l < "$LOG" | tr -d ' ' || echo 0; }
since() { tail -n +"$(( $1 + 1 ))" "$LOG" 2>/dev/null; }
# A refused mod call logs "… → signal {…} FAILED: …" — that is not a pass.
count_since() { since "$1" | grep -F -- "$2" | grep -vc "FAILED" || true; }
fails_since() { since "$1" | grep -F -- "$2" | grep -c "FAILED" || true; }
wait_for() { # wait_for <from-line> <pattern> <seconds>
  local t=0; while [ $t -lt "$3" ]; do
    [ "$(count_since "$1" "$2")" -gt 0 ] && return 0; sleep 1; t=$((t+1)); done; return 1; }

HOST=$(awk '/^  mqtt:/{m=1} m&&/host:/{print $2; exit}' "$CFG")
step "0. preflight"
command -v mosquitto_sub >/dev/null && ok "mosquitto clients" || bad "brew install mosquitto (clients)"
( cd "$SH" && uv run pytest -q tests/test_trapped_house.py >/dev/null 2>&1 ) && ok "test_trapped_house.py green" || bad "test_trapped_house.py failing"
CHECK_OUT=$( cd "$SH" && uv run stagehand check --config "$CFG" 2>&1 ) && ok "stagehand check" || bad "stagehand check --config $CFG fails"
# The tracked YAML keeps its CHANGE-ME; the real values live in the
# git-ignored <name>.local.yaml beside it (or LOOM_EVENT_ID / LOOM_MOD_PASSCODE).
echo "$CHECK_OUT" | grep -q "^PLACEHOLDER" \
  && bad "event id / mod passcode not filled in — create ${CFG%.yaml}.local.yaml with: server: { event: <id>, mod_passcode: \"<code>\" }" \
  || ok "event id + passcode filled in (outside git)"
MYIPS=$(ifconfig | awk '/inet /{print $2}')
BROKER=$(awk -F'"' '/^#define SR_BROKER_IP/{print $2}' "$ROOT/hardware/server-room/server_room/config.h")
echo "$MYIPS" | grep -qx "$BROKER" && ok "this Mac owns the props' broker address $BROKER" || bad "SR_BROKER_IP $BROKER is not this Mac's IP ($(echo $MYIPS | tr '\n' ' ')) — fix the DHCP reservation or config.h"
mosquitto_pub -h "$HOST" -t k05/ping -m x 2>/dev/null && ok "Mosquitto answers on $HOST (stagehand's listener)" || bad "Mosquitto not reachable on $HOST:1883"
mosquitto_pub -h "$BROKER" -p 1883 -t k05/ping -m x 2>/dev/null && bad "anonymous publish on $BROKER:1883 accepted — bind it to 127.0.0.1 (scripts/house-mac/alexa.md → Lock down the broker)" || ok "LAN anonymous publish refused"
( cd "$SH" && uv run stagehand launchd status ) | sed 's/^/    /'
( cd "$SH" && uv run stagehand launchd status ) | grep -q "^show .*running" && ok "show job running" || bad "show job not running"
( cd "$SH" && uv run stagehand launchd status ) | grep -q "^agents .*running" && ok "agents job running" || bad "agents job not running"

step "1. the door contact: an entry with the code and an exit by the handle each → one server_door_opened"
# The contact is direction-blind and stagehand debounces it 20 s, so the two
# openings are kept ≥ 25 s apart. The keypad lock is standalone (its code is
# set by hand to facts.json's door.code): nothing here can lock or unlock it.
DOOR_SIG="sensor sensors/serverroom/door → signal {'name': 'server_door_opened'}"
ask "close the server-room door, step OUTSIDE it, then press enter"
L=$(lines)
ask "type the CODE on the keypad, open the door, step in, let it close behind you, then press enter"
T0=$(date +%s)   # the entry opened before this enter, so the gap is at least what we wait from here
sleep 3
N=$(count_since "$L" "$DOOR_SIG")
F=$(fails_since "$L" "server_door_opened")
[ "$F" = 0 ] || bad "$F server_door_opened call(s) FAILED at the server — wrong event id / passcode, or the VPS is down (see $LOG)"
[ "$N" = 1 ] && ok "entry with the code: one server_door_opened (Run → Log shows it once)" || bad "entry with the code: expected 1 server_door_opened, saw $N"
W=$(( 25 - ($(date +%s) - T0) )); [ "$W" -gt 0 ] && { echo "  · waiting ${W} s (stagehand's 20 s debounce)"; sleep "$W"; }
L=$(lines)
ask "from INSIDE: open by the HANDLE (no code), step out, close the door, then press enter"
yes "did the inside handle open it with no code?" && ok "egress: the inside handle opens with no code" || bad "the inside handle did not open the door — STOP: fix the lock before any guest goes in (HW-SAFE-05)"
sleep 3
N=$(count_since "$L" "$DOOR_SIG")
[ "$N" = 1 ] && ok "exit by the handle: one server_door_opened" || bad "exit by the handle: expected 1 server_door_opened, saw $N"

step "2. restart with the door open fires nothing"
ask "prop the door OPEN, then press enter (the show job restarts)"
L=$(lines); ( cd "$SH" && uv run stagehand launchd restart --job show ) >/dev/null
wait_for "$L" "show feed connected" 60 && ok "show reconnected" || bad "show did not reconnect within 60 s"
sleep 20
N=$(count_since "$L" "server_door_opened")
[ "$N" = 0 ] && ok "no signal after the restart with the door open" || bad "$N signal(s) fired after the restart"
ask "close the door"

step "3. a 60 s WAN pull reconnects on its own"
L=$(lines); ask "UNPLUG the router's WAN (internet) cable now, press enter, wait for the prompt"
sleep 60
ask "plug the WAN back in, then press enter"
wait_for "$L" "show feed connected" 120 && ok "show feed reconnected after the outage" || bad "no reconnect within 120 s of the WAN coming back"

step "4. each combo fires exactly once; the blackout leaves the safe lights on"
MQ=$(mktemp); mosquitto_sub -h "$HOST" -v -t 'wled/+/api' -t 'zigbee2mqtt/+/set' > "$MQ" & SUB=$!
for C in a b; do
  L=$(lines); ask "plug in COMBO $(echo "$C" | tr a-z A-Z) completely, leave it in ~70 s, then press enter"
  N=$(count_since "$L" "'name': 'patch_combo_$C'")
  F=$(fails_since "$L" "'name': 'patch_combo_$C'")
  [ "$F" = 0 ] || bad "patch_combo_$C: $F call(s) FAILED at the server (see $LOG)"
  [ "$N" = 1 ] && ok "patch_combo_$C fired once" || bad "patch_combo_$C fired $N times"
  ask "pull the cables (and restore the house look from Run if it went dark)"
done
kill "$SUB" 2>/dev/null
if grep -q '"ps": 22' "$MQ" || grep -q '"ps":22' "$MQ"; then
  grep -q '^wled/all/api .*"on": *false' "$MQ" && bad "something turned ALL of WLED off" || ok "blackout: per-device WLED offs, tube on preset 22"
else
  echo "  (no blackout seen on MQTT — fire one from Run if the combos didn't, and re-run step 4)"
fi
ask "during the blackout: were the stairs, bathroom, tent, server room + the path to the living room LIT, and the Tube strip dim-on? (answer below)"
read -r -p "  y/n: " Y; [ "$Y" = y ] && ok "safety lights stayed on" || bad "a safety light went dark — fix the Z2M groups / WLED preset 22"
rm -f "$MQ"

echo; echo "K-05: $PASS passed, $FAIL failed"; [ "$FAIL" = 0 ]
