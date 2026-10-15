#!/usr/bin/env bash
# K-29 — the terminal heartbeat card (OCT31.md §5).
#
#   MOD_CODE=<mod passcode> scripts/accept/K-29.sh            the heartbeat list now (what the card reads)
#   MOD_CODE=… scripts/accept/K-29.sh --watch                 re-print it every 4 s (the card's own rate)
#   MOD_CODE=… scripts/accept/K-29.sh --fake "K-29 test"      poll ONCE as a fake terminal: it appears
#                                                             live on the card, goes red + chimes ~20 s
#                                                             later (no tablet needed). ✕ it afterwards.
#   BASE=http://localhost:7000 MOD_CODE=… scripts/accept/K-29.sh   against a local server
#
# Device check (≤ 10 min):
#   1. Editor → the project → Run (Run page, server run going). Click anywhere once
#      (browsers only play sound after a gesture). Keep the tab in the foreground.
#   2. Every tablet + the TV shows up in the "Terminals" card, green; the header shows 📟 N/N.
#   3. Pull one tablet off Wi-Fi (Wi-Fi off / airplane mode). Start a stopwatch.
#      → within 30 s its row turns red ("silent 2x s"), 📟 turns red, the editor chimes.
#      Leave it: the chime repeats each minute until you press "ack".
#   4. Wi-Fi back on → the row goes green within ~5 s (Fully Kiosk keeps the page polling).
#   5. Optional: 🔊 TV voice on/muted on the card flips the TV's voice (the TV shows captions only).
set -euo pipefail

BASE="${BASE:-https://app.mapsandducks.com}"
: "${MOD_CODE:?set MOD_CODE to the moderator passcode from the Run page}"

json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
resolved=$(curl -fsS -X POST "$BASE/api/resolve-code" -H 'content-type: application/json' -d "{\"code\":\"$MOD_CODE\"}")
event=$(printf '%s' "$resolved" | json "d['eventId']")
role=$(printf '%s' "$resolved" | json "d['role']")
[[ "$role" == "mod" ]] || { echo "FAIL that code is a $role code, not the moderator passcode"; exit 1; }
token=$(curl -fsS -X POST "$BASE/e/$event/api/mod/login" -H 'content-type: application/json' -d "{\"passcode\":\"$MOD_CODE\"}" | json "d['token']")

show() {
  curl -fsS -H "x-loom-token: $token" "$BASE/e/$event/api/mod/screen/terminals" | python3 -I -c '
import json, sys
d = json.load(sys.stdin)
lim = d["silentMs"]
voice = "MUTED" if d["voiceMuted"] else "on"
print("terminals - silent after %d s - TV voice %s" % (lim // 1000, voice))
if not d["terminals"]:
    print("  (no terminal has polled since the server started)")
for t in d["terminals"]:
    state = "SILENT" if t["ago"] >= lim else "live  "
    where = " / ".join(x for x in (t["spot"], t["view"]) if x)
    print("  %s %-24s %-24s last poll %5.1f s ago" % (state, t["name"], where, t["ago"] / 1000))
'
}

case "${1:-}" in
  --fake)
    name=$(python3 -I -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "${2:-K-29 test}")
    curl -fsS -o /dev/null -H "x-loom-token: $token" "$BASE/e/$event/api/screen/state?name=$name&spot=&view=auto&character=Trabolta"
    echo "polled once as \"${2:-K-29 test}\" — watch the card: live now, red + chime in ~20–25 s"
    show ;;
  --watch)
    while true; do clear; date '+%H:%M:%S'; show; sleep 4; done ;;
  "")
    show ;;
  *)
    sed -n '2,25p' "$0"; exit 2 ;;
esac
