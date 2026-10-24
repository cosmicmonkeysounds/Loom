#!/usr/bin/env bash
# K-20 — the house announcements and story sounds through the house speakers
# (OCT31.md §5). Wave 18b: the player is stagehand's `audio` module (the
# router, launchd job `audio`) on the 828x; the old `alexa` job is retired
# (scripts/house-macbook/audio.md → *Retire the alexa job, switch the router on*).
# Run ON THE ROUTER MACHINE (John's MacBook by default), top to bottom;
# stand where you can hear the living room AND the kitchen (or have someone
# in the kitchen). ≈ 10 minutes.
#
#   scripts/accept/K-20.sh devices    1. CoreAudio devices — the 828x must be listed (audio.json device.name)
#   scripts/accept/K-20.sh check      2. `stagehand check --only audio`: 32 / 30 channels, layout not
#                                        moved, placeholders still present listed
#   scripts/accept/K-20.sh install    3. install / restart the router's launchd job (`launchd install --job audio`)
#   scripts/accept/K-20.sh announce   4. one announcement through the router now (`stagehand announce`)
#   scripts/accept/K-20.sh chime      5. `sound announce_chime` alone (show/chime)
#   scripts/accept/K-20.sh play [name] 6. one story sound by hand (`stagehand sounds play`, default zip)
#   scripts/accept/K-20.sh stop       7. ■ stop: every house sound and the announcement fade out
#   MOD_CODE=… scripts/accept/K-20.sh story [event]
#                                     8. THE ACCEPTANCE: fire a story event whose beat does
#                                        `do announce` (default call_to_the_desktop) on a
#                                        REHEARSAL run and time it — chime + line in both
#                                        rooms within 3 s. (Or fire it from Run → Director.)
#                                        Runs the live guard first (refuses real guests unless
#                                        --i-know-this-is-live; y/N unless --yes).
#   scripts/accept/K-20.sh status     launchd state + the last log lines
#
# CONFIG=<yaml> (default stagehand/trapped.macbook.yaml) · BASE (default https://app.mapsandducks.com)
set -euo pipefail
source "$(dirname "$0")/guard.sh" "$@"; set -- ${ARGS[@]+"${ARGS[@]}"}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGEHAND="$ROOT/stagehand"
CONFIG="${CONFIG:-$STAGEHAND/trapped.macbook.yaml}"
BASE="${BASE:-https://app.mapsandducks.com}"
LOG="$HOME/Library/Logs/stagehand/audio.log"
LABEL=com.mapsandducks.stagehand.audio
LINE="${LINE:-This is a test of the house speakers. Living room and kitchen.}"

stage() { (cd "$STAGEHAND" && uv run "$@"); }
need_config() { [[ -f "$CONFIG" ]] || { echo "FAIL no $CONFIG"; exit 1; }; }
broker() { python3 -I -c 'import sys,yaml; a=yaml.safe_load(open(sys.argv[1]))["audio"]["mqtt"]; print(a["host"], a.get("port",1883))' "$CONFIG" 2>/dev/null || echo "127.0.0.1 1883"; }
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
    echo "→ the 828x must be listed with 32 in / 30 out (CueMix: Main outs + Phones NOT mirrored, 48 kHz)" ;;
  check)
    need_config
    stage stagehand check --config "$CONFIG" --only audio
    echo "PASS if: no 'layout has moved', the device reports 32 / 30, and no placeholder sounds are left before the show" ;;
  install)
    need_config
    stage stagehand launchd install --job audio --config "$CONFIG"
    stage stagehand launchd restart --job audio --config "$CONFIG" || true ;;
  status)
    launchctl print "gui/$UID/$LABEL" 2>/dev/null | grep -E "state =|pid =|last exit" || echo "job not loaded — run: $0 install"
    tail -n 15 "$LOG" 2>/dev/null || true ;;
  announce)
    need_config
    stage stagehand announce --config "$CONFIG" "$LINE"
    echo "PASS if: 'sent to the router', then one chime and the line in the living room AND the kitchen" ;;
  chime)
    need_config
    pub show/chime "{}"
    echo "PASS if: the chime alone, in both rooms" ;;
  play)
    need_config
    stage stagehand sounds play --config "$CONFIG" "${2:-zip}"
    echo "PASS if: the sound (or its labelled placeholder) on its rooms' speakers" ;;
  stop)
    need_config
    stage stagehand sounds stop --config "$CONFIG" --announce
    echo "PASS if: whatever was playing (a sound, an announcement) fades out within a second" ;;
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
    if wait_log "$n" "chime\|announce" 5; then
      printf 'the router heard it %.1f s after the fire (budget 3 s)\n' "$(python3 -c "import time; print(time.time() - $t0)")"
    else
      echo "FAIL nothing reached the router in 5 s — is the show job running (show/announce rule), the audio job up and the broker up? ($0 status)"; exit 1
    fi
    echo "PASS if: one chime + the line in the living room AND the kitchen" ;;
  *)
    sed -n '2,25p' "$0"; exit 2 ;;
esac
