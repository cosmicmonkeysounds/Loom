#!/usr/bin/env bash
# K-30 acceptance: a Quest 3 finds the golden duck on the VPS over HTTPS → released.
# Run on the Mac with the Godot editor + Android SDK, headsets charged, a USB-C
# cable, and an event running on the VPS (the preview is fine). ~10 minutes,
# most of it the two APK exports and the walk to Gerald.
#
#   scripts/accept/K-30.sh [--server https://app.mapsandducks.com] [--stations "vr-1 vr-2"]
#                          [--guest g-xxxxxx] [--skip-build] [--debug]
#
# The mod passcode is read from LOOM_MOD_CODE or asked for (never echoed,
# never written outside the git-ignored reinstall/vr/build/). Before the walk,
# capture a guest in Run mode (or the tablet) so the find is a *release*;
# an uncaptured guest still finds Gerald but shows "YOU FOUND GERALD".
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VR="$ROOT/reinstall/vr"
Q="$VR/tools/quest.sh"
SERVER="https://app.mapsandducks.com"
STATIONS="vr-1 vr-2"
GUEST=""
SKIP_BUILD=0
DEBUG=()
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER="$2"; shift ;;
    --stations) STATIONS="$2"; shift ;;
    --guest) GUEST="$2"; shift ;;
    --skip-build) SKIP_BUILD=1 ;;
    --debug) DEBUG=(--debug) ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
  shift
done
TMP="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null; rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()   { echo "  ✔ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $*"; FAIL=$((FAIL+1)); }
step() { echo; echo "── $*"; }
ask()  { read -r -p "  → $* [enter] " _; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
api()  { # api METHOD PATH [JSON]
  if [ -n "${3:-}" ]; then curl -fsS -X "$1" -H "content-type: application/json" -H "x-loom-token: ${TOKEN:-}" -d "$3" "$SERVER$2"
  else curl -fsS -X "$1" -H "x-loom-token: ${TOKEN:-}" "$SERVER$2"; fi
}
ADB="$(QUEST_SH_SOURCE_ONLY=1 bash -c ". '$Q'; adb_bin" 2>/dev/null)"

step "0. toolchain (tools/quest.sh setup)"
if "$Q" setup; then ok "toolchain green"; else bad "fix the setup items above, then re-run"; exit 1; fi

step "1. the VPS over HTTPS"
case "$SERVER" in https://*) ok "server is HTTPS ($SERVER)";; *) bad "$SERVER is not HTTPS — the APK has no cleartext permission";; esac
CODE="${LOOM_MOD_CODE:-}"
[ -n "$CODE" ] || { read -r -s -p "  → the event's MOD passcode: " CODE; echo; }
EVENT="$(api POST /api/resolve-code "{\"code\":\"$CODE\"}" | json 'd["eventId"] if d.get("role")=="mod" else ""')"
[ -n "$EVENT" ] && ok "passcode resolves to event $EVENT (role mod)" || { bad "the passcode doesn't resolve to a mod role on $SERVER"; exit 1; }
TOKEN="$(api POST "/e/$EVENT/api/mod/login" "{\"passcode\":\"$CODE\"}" | json 'd["token"]')"
[ -n "$TOKEN" ] && ok "mod login" || { bad "mod login failed"; exit 1; }
api GET "/e/$EVENT/api/spatial/house" >/dev/null && ok "house map served" || bad "GET /api/spatial/house failed (no map?)"

if [ $SKIP_BUILD = 0 ]; then
  step "2. export one APK per headset (station + passcode baked in)"
  for st in $STATIONS; do
    if LOOM_MOD_CODE="$CODE" "$Q" build ${DEBUG[@]+"${DEBUG[@]}"} --station "$st" --server "$SERVER" > "$TMP/build-$st.log" 2>&1; then
      ok "built $(tail -3 "$TMP/build-$st.log" | grep '^built' | sed 's/^built //')"
    else bad "export for $st failed — tail of the log:"; tail -15 "$TMP/build-$st.log" | sed 's/^/      /'; exit 1; fi
  done
fi

step "3. sideload + first contact"
for st in $STATIONS; do
  apk="$VR/build/reinstall-vr-$st.apk"; [ ${#DEBUG[@]} -gt 0 ] && apk="$VR/build/reinstall-vr-$st-debug.apk"
  [ -f "$apk" ] || { bad "$apk missing (drop --skip-build)"; continue; }
  ask "plug ONLY the headset for $st in by USB-C, wake it, accept 'Allow USB debugging' (tick Always)"
  n="$("$ADB" devices | awk 'NR>1 && $2=="device"' | wc -l | tr -d ' ')"
  [ "$n" = 1 ] || { bad "adb sees $n authorised headsets (want 1): $("$ADB" devices | tail -n +2 | tr '\n' ' ')"; continue; }
  if "$Q" install "$apk" > "$TMP/install-$st.log" 2>&1; then ok "$st: installed + launched"
  else bad "$st: install failed:"; tail -5 "$TMP/install-$st.log" | sed 's/^/      /'; continue; fi
  echo "    waiting up to 60 s for $st to poll the VPS (put the headset on if it sleeps)…"
  t=0; online=""
  while [ $t -lt 60 ]; do
    online="$(api GET "/e/$EVENT/api/mod/spatial/stations" | json "next((s['name'] for s in d['stations'] if s['id']=='$st' and s['online']), '')")"
    [ -n "$online" ] && break; sleep 2; t=$((t+2))
  done
  [ -n "$online" ] && ok "$st ('$online') is polling the VPS over HTTPS" || bad "$st never polled — 'tools/quest.sh logs' while it starts; the lobby line says what is wrong"
done

step "4. the walk: find Gerald → released"
FIRST="${STATIONS%% *}"
if [ -z "$GUEST" ]; then
  api GET "/e/$EVENT/api/mod/spatial/candidates" > "$TMP/cand.json"
  GUEST="$(json 'next((p["id"] for p in d["players"] if p["captured"]), d["players"][0]["id"] if d["players"] else "")' < "$TMP/cand.json")"
  CAPT="$(json 'next((p["name"] for p in d["players"] if p["captured"]), "")' < "$TMP/cand.json")"
  [ -n "$CAPT" ] && ok "captured program to send: $CAPT ($GUEST)" || echo "    (nobody is captured — the find will count, but not as a release; capture one in Run mode to see 'released')"
fi
[ -n "$GUEST" ] || { bad "no guests in the event — join one on a phone first"; exit 1; }
curl -sN "$SERVER/e/$EVENT/api/spatial/stream?name=K-30&token=$TOKEN" > "$TMP/stream.txt" 2>/dev/null &
sleep 1
api POST "/e/$EVENT/api/mod/spatial/begin" "{\"guest\":\"$GUEST\",\"world\":\"vr\",\"station\":\"$FIRST\",\"device\":\"K-30\"}" >/dev/null \
  && ok "sent $GUEST to $FIRST (parked until the headset's first pose)" || bad "begin failed"
echo "    put on $FIRST (seated, snap turn): the game should start within a second;"
echo "    follow the golden chevrons to Gerald. Waiting up to 5 min for 'found'…"
t=0; line=""
while [ $t -lt 300 ]; do
  line="$(grep -A1 '^event: found' "$TMP/stream.txt" | grep '^data:' | head -1)"
  [ -n "$line" ] && break; sleep 2; t=$((t+2))
done
if [ -z "$line" ]; then bad "no 'found' in 5 min"
elif echo "$line" | grep -q '"released":true'; then ok "FOUND on the VPS → released ($line)"
else ok "found (not a release — the program wasn't captured): $line"; fi
ask "the headset showed REINSTALLATION COMPLETE (or YOU FOUND GERALD) and went back to the lobby"

echo; echo "K-30: $PASS passed, $FAIL failed"
[ $FAIL = 0 ]
