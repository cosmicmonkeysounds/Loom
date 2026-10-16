#!/usr/bin/env bash
# K-20 — the house announcements through the house speakers (OCT31.md §5;
# the player is stagehand's `alexa` module — the module name stays). Run ON THE
# HOUSE MAC, top to bottom; stand where you can hear the living room AND the
# kitchen (or have someone in the kitchen). ≈ 10 minutes.
#
#   scripts/accept/K-20.sh devices    1. CoreAudio outputs — copy the MOTU's name into alexa.device
#   scripts/accept/K-20.sh local      2. chime + the Mac's `say` voice on Z1 + Z2 now (no broker, no story)
#   scripts/accept/K-20.sh offline    3. the same line with no server link at all (what engine: say
#                                        always does; with engine: server, the internet-down voice)
#   scripts/accept/K-20.sh install    4. install / restart the launchd agent (install-alexa.sh)
#   scripts/accept/K-20.sh mqtt       5. publish show/announce like the show does → the agent plays it
#   scripts/accept/K-20.sh chime      6. `sound announce_chime` alone (show/chime)
#   MOD_CODE=… scripts/accept/K-20.sh story [event]
#                                     7. THE ACCEPTANCE: fire a story event whose beat does
#                                        `do announce` (default call_to_the_desktop) on a
#                                        REHEARSAL run and time it — chime + line in both
#                                        rooms within 3 s. (Or fire it from Run → Director.)
#                                        Runs the live guard first (refuses real guests unless
#                                        --i-know-this-is-live; y/N unless --yes).
#   scripts/accept/K-20.sh status     launchd state + the last log lines
#
# CONFIG=<yaml> (default stagehand/house.yaml) · BASE (default https://app.mapsandducks.com)
set -euo pipefail
source "$(dirname "$0")/guard.sh" "$@"; set -- ${ARGS[@]+"${ARGS[@]}"}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGEHAND="$ROOT/stagehand"
CONFIG="${CONFIG:-$STAGEHAND/house.yaml}"
BASE="${BASE:-https://app.mapsandducks.com}"
LOG="$HOME/Library/Logs/stagehand-alexa.log"
LABEL=com.mapsandducks.stagehand-alexa
LINE="${LINE:-This is a test of the house speakers. Living room and kitchen.}"

stage() { (cd "$STAGEHAND" && uv run "$@"); }
need_config() { [[ -f "$CONFIG" ]] || { echo "FAIL no $CONFIG — cp stagehand/trapped.house.yaml stagehand/house.yaml and set server.* + alexa.device"; exit 1; }; }
broker() { python3 -I -c 'import sys,yaml; a=yaml.safe_load(open(sys.argv[1]))["alexa"]["mqtt"]; print(a["host"], a.get("port",1883))' "$CONFIG" 2>/dev/null || echo "127.0.0.1 1883"; }
pub() {
  read -r host port < <(broker)
  if command -v mosquitto_pub > /dev/null; then
    mosquitto_pub -h "$host" -p "$port" -t "$1" -m "$2"
  else
    stage python -c 'import sys,paho.mqtt.publish as p; p.single(sys.argv[3], sys.argv[4], hostname=sys.argv[1], port=int(sys.argv[2]))' "$host" "$port" "$1" "$2"
  fi
}
wait_log() { # wait_log <since-line-count> <pattern> <seconds>
  local t0=$SECONDS
  while (( SECONDS - t0 < $3 )); do
    if tail -n +"$(( $1 + 1 ))" "$LOG" 2>/dev/null | grep -q "$2"; then return 0; fi
    sleep 0.2
  done
  return 1
}

case "${1:-}" in
  devices)
    stage python -m sounddevice
    echo "→ put a unique part of the MOTU's name in alexa.device; Z1 = ch 1/2, Z2 = ch 3/4 (alexa.channels)" ;;
  local)
    need_config
    stage stagehand announce --config "$CONFIG" "$LINE"
    echo "PASS if: one chime, then the line, in the living room AND the kitchen ('played via device-say' = the Mac's voice; 'via device' = the opt-in server voice)" ;;
  offline)
    need_config
    stage stagehand announce --config "$CONFIG" --offline "$LINE"
    echo "PASS if: chime + the macOS voice in both rooms ('played via device-say')" ;;
  install)
    "$ROOT/scripts/house-mac/install-alexa.sh" --config "$CONFIG" ;;
  status)
    launchctl print "gui/$UID/$LABEL" 2>/dev/null | grep -E "state =|pid =|last exit" || echo "agent not loaded — run: $0 install"
    tail -n 15 "$LOG" 2>/dev/null || true ;;
  mqtt)
    need_config
    n=$(wc -l < "$LOG" 2>/dev/null || echo 0)
    pub show/announce "{\"text\": \"$LINE\"}"
    if wait_log "$n" "received" 3; then echo "agent received it"; else echo "FAIL the agent logged nothing in 3 s — $0 status"; exit 1; fi
    wait_log "$n" " via " 20 && tail -n +"$(( n + 1 ))" "$LOG" | grep " via " | tail -1
    echo "PASS if: chime + line in both rooms" ;;
  chime)
    need_config
    pub show/chime "{}"
    echo "PASS if: the chime alone, in both rooms" ;;
  story)
    : "${MOD_CODE:?set MOD_CODE to the moderator passcode of a REHEARSAL run}"
    ev="${2:-call_to_the_desktop}"
    json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
    resolved=$(curl -fsS -X POST "$BASE/api/resolve-code" -H 'content-type: application/json' -d "{\"code\":\"$MOD_CODE\"}")
    event=$(printf '%s' "$resolved" | json "d['eventId']")
    token=$(curl -fsS -X POST "$BASE/e/$event/api/mod/login" -H 'content-type: application/json' -d "{\"passcode\":\"$MOD_CODE\"}" | json "d['token']")
    guard_writes "fire $ev (it moves the story)"
    n=$(wc -l < "$LOG" 2>/dev/null || echo 0)
    t0=$(python3 -c 'import time; print(time.time())')
    curl -fsS -X POST "$BASE/e/$event/api/mod/signal" -H "x-loom-token: $token" -H 'content-type: application/json' -d "{\"name\":\"$ev\"}" > /dev/null
    if wait_log "$n" "received" 5; then
      printf 'received %.1f s after the fire (the chime starts now; budget 3 s)\n' "$(python3 -c "import time; print(time.time() - $t0)")"
    else
      echo "FAIL nothing reached the player in 5 s — is the show job running (show/announce rule) and the broker up?"; exit 1
    fi
    wait_log "$n" " via " 20 && tail -n +"$(( n + 1 ))" "$LOG" | grep " via " | tail -1
    echo "PASS if: one chime + the line in the living room AND the kitchen (a 'merged' chime line means no double chime)" ;;
  *)
    sed -n '2,20p' "$0"; exit 2 ;;
esac
