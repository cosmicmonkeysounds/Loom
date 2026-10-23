#!/usr/bin/env bash
# K-05 bench acceptance (wave 20), run ON THE HOUSE MAC with the real door
# (its standalone keypad lock + the LED / LDR sensor on the Grand Central M4),
# Steph's laptop running the server-room terminal page with the sensor
# connected (`door=serial`), the patch bay and the lights powered. ~12
# minutes; it tells you when to touch what and checks the event, stagehand's
# log and the MQTT traffic for you.
#
#   MOD_CODE=<mod passcode> scripts/accept/K-05.sh [path/to/trapped.house.yaml]
#   BASE=http://localhost:7000 MOD_CODE=… scripts/accept/K-05.sh   against a local server
#
# The door no longer goes through stagehand (D16): the M4 reports it over USB
# to the terminal page, which posts door_sensor_opened / _closed to the event
# (contract §2.1, §2.5). So steps 1–2 read the event (the terminal's
# heartbeat + the story's Night.server_door), and stagehand must fire NO door
# signal. Use a REHEARSAL whose doors are open and whose Power On has played
# (Night.server_door set); run N-20 (the sensor's bench check) first.
#
# Needs: uv, mosquitto clients (brew install mosquitto), python3, node (the
# live guard), the `show` and `agents` launchd jobs installed, and the event
# id + mod passcode in the git-ignored trapped.house.local.yaml for stagehand.
set -u
source "$(dirname "$0")/guard.sh" "$@"; set -- ${ARGS[@]+"${ARGS[@]}"}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SH="$ROOT/stagehand"
CFG="${1:-$SH/trapped.house.yaml}"
LOG="$HOME/Library/Logs/stagehand/show.log"
BASE="${BASE:-$(awk '/^server:/{m=1} m&&/^  url:/{print $2; exit}' "$CFG")}"
BASE="${BASE:-https://app.mapsandducks.com}"
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
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }

# watch <seconds> <file>: every 250 ms, the server-room terminal's door (its
# heartbeat) and the story's door, one line per change:
#   +1.25s sensor open lvl 35 fault - warn - · story open · override false
watch_door() {
  python3 -I - "$BASE" "$event" "$token" "$1" > "$2" <<'PY'
import json, sys, time, urllib.request
base, event, token, secs = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
def get(path):
    r = urllib.request.Request(f"{base}/e/{event}{path}", headers={"x-loom-token": token})
    with urllib.request.urlopen(r, timeout=5) as f: return json.load(f)
t0, last = time.time(), None
while time.time() - t0 < secs:
    try:
        terms = [t for t in get("/api/mod/screen/terminals")["terminals"] if "door" in t]
        night = get("/api/screen/state").get("night") or {}
    except Exception as e:  # keep watching through a blip
        print(f"+{time.time() - t0:5.2f}s error {e}", flush=True); time.sleep(0.5); continue
    t = terms[0] if terms else {}
    now = (t.get("door", "none"), t.get("doorFault") or "-", t.get("doorWarn") or "-",
           night.get("server_door"), night.get("door_override"))
    if now != last:
        print(f"+{time.time() - t0:5.2f}s sensor {now[0]} lvl {t.get('doorLevel', '-')} fault {now[1]} warn {now[2]} · story {now[3]} · override {now[4]}", flush=True)
        last = now
    time.sleep(0.25)
PY
}
# Seconds from the start of a watch to the first line matching a pattern.
first_at() { grep -m1 -E -- "$2" "$1" | sed -E 's/^\+ *([0-9.]+)s.*/\1/'; }

HOST=$(awk '/^  mqtt:/{m=1} m&&/host:/{print $2; exit}' "$CFG")
step "0. preflight"
: "${MOD_CODE:?set MOD_CODE to the moderator passcode of a rehearsal (Run page)}"
command -v mosquitto_sub >/dev/null && ok "mosquitto clients" || bad "brew install mosquitto (clients)"
( cd "$SH" && uv run pytest -q tests/test_trapped_house.py >/dev/null 2>&1 ) && ok "test_trapped_house.py green" || bad "test_trapped_house.py failing"
CHECK_OUT=$( cd "$SH" && uv run stagehand check --config "$CFG" 2>&1 ) && ok "stagehand check" || bad "stagehand check --config $CFG fails"
# The tracked YAML keeps its CHANGE-ME; the real values live in the
# git-ignored <name>.local.yaml beside it (or LOOM_EVENT_ID / LOOM_MOD_PASSCODE).
echo "$CHECK_OUT" | grep -q "^PLACEHOLDER" \
  && bad "event id / mod passcode not filled in — create ${CFG%.yaml}.local.yaml with: server: { event: <id>, mod_passcode: \"<code>\" }" \
  || ok "event id + passcode filled in (outside git)"
grep -qE 'sensors/serverroom/door|zigbee2mqtt/server_room_door' "$CFG" \
  && bad "$CFG still has a door rule (sensors/serverroom/door or the Zigbee contact): D16 moved the door to the M4 — pull the wave 20 YAML and restart the show job" \
  || ok "no door rule left in stagehand (the M4 owns the door)"
MYIPS=$(ifconfig | awk '/inet /{print $2}')
BROKER=$(awk -F'"' '/^#define SR_BROKER_IP/{print $2}' "$ROOT/hardware/server-room/server_room/config.h")
echo "$MYIPS" | grep -qx "$BROKER" && ok "this Mac owns the props' broker address $BROKER" || bad "SR_BROKER_IP $BROKER is not this Mac's IP ($(echo $MYIPS | tr '\n' ' ')) — fix the DHCP reservation or config.h"
mosquitto_pub -h "$HOST" -t k05/ping -m x 2>/dev/null && ok "Mosquitto answers on $HOST (stagehand's listener)" || bad "Mosquitto not reachable on $HOST:1883"
mosquitto_pub -h "$BROKER" -p 1883 -t k05/ping -m x 2>/dev/null && bad "anonymous publish on $BROKER:1883 accepted — bind it to 127.0.0.1 (scripts/house-mac/audio.md → Lock down the broker)" || ok "LAN anonymous publish refused"
( cd "$SH" && uv run stagehand launchd status ) | sed 's/^/    /'
( cd "$SH" && uv run stagehand launchd status ) | grep -q "^show .*running" && ok "show job running" || bad "show job not running"
( cd "$SH" && uv run stagehand launchd status ) | grep -q "^agents .*running" && ok "agents job running" || bad "agents job not running"

resolved=$(curl -fsS -X POST "$BASE/api/resolve-code" -H 'content-type: application/json' -d "{\"code\":\"$MOD_CODE\"}") || { bad "resolve-code failed at $BASE"; exit 1; }
event=$(printf '%s' "$resolved" | json "d['eventId']")
[ "$(printf '%s' "$resolved" | json "d['role']")" = mod ] || { bad "MOD_CODE is not a moderator passcode"; exit 1; }
token=$(curl -fsS -X POST "$BASE/e/$event/api/mod/login" -H 'content-type: application/json' -d "{\"passcode\":\"$MOD_CODE\"}" | json "d['token']")
ok "event $event"
guard_writes "open and shut the real server-room door into this event (door_sensor_opened / _closed from the terminal)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
watch_door 2 "$TMP/now"; cat "$TMP/now" | sed 's/^/    /'
grep -qE "sensor (open|closed)" "$TMP/now" && ok "the server-room terminal reports the door (door=serial, sensor connected, no fault)" \
  || bad "no terminal reports a door, or it reads fault/none: on Steph's laptop hold ⚙ 2 s → Connect door sensor; Run → Terminals shows why"
grep -qE "story (open|closed)" "$TMP/now" && ok "Night.server_door is set (Power On has played)" || bad "Night.server_door is null: open the doors / play Power On first, else the bridge posts nothing"
grep -qE "override [Tt]rue" "$TMP/now" && bad "door_override is on: press 🚪 Trust the door sensor on Run first" || ok "the story follows the sensor (no override)"

step "1. the door: an entry with the code and an exit by the handle"
# Each is one opening and one closing at the sensor and in the story, within
# about a second each; stagehand fires nothing for the door any more.
for leg in entry exit; do
  if [ "$leg" = entry ]; then
    ask "close the server-room door and step OUTSIDE it"
    L=$(lines)
    echo "  → when you press enter you have 25 s: type the CODE on the keypad, open the door, step in, let it close behind you"
    read -r -p "  → ready? [enter] " _
  else
    L=$(lines)
    echo "  → when you press enter you have 25 s: from INSIDE open by the HANDLE (no code), step out, close the door"
    read -r -p "  → ready? [enter] " _
  fi
  watch_door 25 "$TMP/$leg"
  sed 's/^/    /' "$TMP/$leg"
  o=$(first_at "$TMP/$leg" "sensor open"); so=$(first_at "$TMP/$leg" "story open")
  c=$(first_at "$TMP/$leg" "sensor closed"); sc=$(first_at "$TMP/$leg" "story closed")
  [ -n "$o" ] && [ -n "$so" ] && ok "$leg: opened (sensor +${o}s, story +${so}s)" || bad "$leg: no opening reached the story (sensor ${o:-never}, story ${so:-never})"
  [ -n "$so" ] && [ -n "$o" ] && python3 -c "import sys; sys.exit(0 if float('$so') - float('$o') <= 2.0 else 1)" \
    && ok "$leg: the story followed the sensor within 2 s" || bad "$leg: the story lagged the sensor (or never followed)"
  [ -n "$c" ] && [ -n "$sc" ] && ok "$leg: closed again (sensor +${c}s, story +${sc}s)" || bad "$leg: the close never reached the story (a door left ajar? thresholds? N-20)"
  grep -q "fault [a-z]" "$TMP/$leg" && bad "$leg: the sensor reported a fault: $(grep -m1 -o 'fault [a-z_]*' "$TMP/$leg")" || ok "$leg: no fault"
  grep -q "override [Tt]rue" "$TMP/$leg" && bad "$leg: door_override came on (someone pressed 🚪?)" || true
  [ "$(count_since "$L" "server_door_opened")" = 0 ] && ok "$leg: stagehand fired no door signal (D16)" || bad "$leg: stagehand still fires server_door_opened — an old door rule is running"
  if [ "$leg" = entry ]; then
    yes "did the keypad open with the code?" && ok "the keypad takes the code" || bad "the keypad refused the code: reprogram it to facts.json door.code"
  else
    yes "did the inside handle open it with no code?" && ok "egress: the inside handle opens with no code" || bad "the inside handle did not open the door — STOP: fix the lock before any guest goes in (HW-SAFE-05)"
  fi
done

step "2. the sensor's cable: unplugged → fault, nothing posted; back → reconnects by itself"
ask "door SHUT. On Steph's laptop, UNPLUG the Grand Central's USB cable, then press enter"
watch_door 8 "$TMP/unplug"; sed 's/^/    /' "$TMP/unplug"
grep -qE "sensor fault .*fault (no_port|stale)" "$TMP/unplug" && ok "the terminal reports the fault (no_port / stale) within 8 s" || bad "no fault on the heartbeat after unplugging (Run → Terminals would show 🚪 red)"
grep -q "story open" "$TMP/unplug" && bad "the story's door opened on an unplugged sensor (the bridge must post nothing in a fault)" || ok "the story's door didn't move"
ask "plug the USB cable back in (no clicks on the laptop), then press enter"
watch_door 15 "$TMP/replug"; sed 's/^/    /' "$TMP/replug"
tail -1 "$TMP/replug" | grep -q "sensor closed .*fault -" && ok "back to closed, no fault, with no prompt (navigator.serial.getPorts)" \
  || bad "the sensor didn't come back by itself: reload the terminal page; if Chrome asks for the port again, grant it in the kiosk profile"

step "3. a 60 s WAN pull reconnects on its own"
L=$(lines); ask "UNPLUG the router's WAN (internet) cable now, press enter, wait for the prompt"
sleep 60
ask "plug the WAN back in, then press enter"
wait_for "$L" "show feed connected" 120 && ok "show feed reconnected after the outage" || bad "no reconnect within 120 s of the WAN coming back"
watch_door 6 "$TMP/wan"
grep -q "sensor closed .*fault -" "$TMP/wan" && ok "the door terminal is posting again (heartbeat fresh, sensor closed)" || bad "the door terminal didn't come back after the WAN pull: $(tail -1 "$TMP/wan")"

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
ask "during the blackout: were the stairs, bathroom, tent, server room (its RGB bulb, never under 80) + the path to the living room LIT, and the Tube strip dim-on? (answer below)"
read -r -p "  y/n: " Y; [ "$Y" = y ] && ok "safety lights stayed on" || bad "a safety light went dark — fix the Z2M groups / WLED preset 22"
rm -f "$MQ"

echo; echo "K-05: $PASS passed, $FAIL failed"
echo "Afterwards: 🔄 reset_server_room on Run so the heart is sealed again (contract §5.3 step 7)."
[ "$FAIL" = 0 ]
