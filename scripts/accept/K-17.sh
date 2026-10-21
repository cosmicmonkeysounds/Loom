#!/usr/bin/env bash
# K-17 (+ N-03) — overlays, PNG slides, the corner countdown, precedence (OCT31.md §5).
#
#   MOD_CODE=<mod passcode> scripts/accept/K-17.sh            one look at what the TV and the
#                                                            terminals are told to layer
#   MOD_CODE=<mod passcode> scripts/accept/K-17.sh --watch    poll every 2 s, print each change
#   MOD_CODE=… scripts/accept/K-17.sh --fire <event> [...]   fire named events (Director-style)
#                                                            between looks, e.g. --fire call_to_the_desktop
#   BASE=http://localhost:7000 MOD_CODE=… scripts/accept/K-17.sh   against a local server
#
# The looks poll with no terminal name (view=mirror → the TV's program, view=auto → the
# terminals'), so they never land in Run → Terminals (`/api/mod/screen/terminals`, the K-29 card).
# --fire WRITES to the event: it runs the live guard first (refuses a roster with real
# guests unless --i-know-this-is-live; asks y/N unless --yes or localhost).
# It also lists which slide PNGs the server has (the rest render as Win98 text cards).
set -euo pipefail
source "$(dirname "$0")/guard.sh" "$@"; set -- ${ARGS[@]+"${ARGS[@]}"}

BASE="${BASE:-https://app.mapsandducks.com}"
: "${MOD_CODE:?set MOD_CODE to the moderator passcode from the Run page}"

json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }

resolved=$(curl -fsS -X POST "$BASE/api/resolve-code" -H 'content-type: application/json' -d "{\"code\":\"$MOD_CODE\"}")
event=$(printf '%s' "$resolved" | json "d['eventId']")
role=$(printf '%s' "$resolved" | json "d['role']")
[[ "$role" == "mod" ]] || { echo "FAIL that code is a $role code, not the moderator passcode"; exit 1; }
token=$(curl -fsS -X POST "$BASE/e/$event/api/mod/login" -H 'content-type: application/json' -d "{\"passcode\":\"$MOD_CODE\"}" | json "d['token']")

look() { curl -fsS -H "x-loom-token: $token" "$BASE/e/$event/api/screen/state?spot=&view=$2&character=Trabolta"; }
# One line per target: attract, the slide (age / persist), overlay, blackout, flicker, countdown.
line() {
  printf '%s' "$1" | json "'%-9s attract=%-5s slide=%s overlay=%s blackout=%s flicker=%s countdown=%s %s' % (d['target'], d['attract'], (lambda s: 'none' if s is None else '%s[%s%s%s]' % (s['cue'], s['kind'], ',persist' if s['persist'] else '', ',%ss ago' % ((d['now'] - s['at']) // 1000) if s['at'] else ',history'))(d['program']['slide']), (d['program']['overlay'] or {}).get('value'), (d['program']['blackout'] or {}).get('seq'), (d['program']['flicker'] or {}).get('seq'), d['countdown'], d['remaining'])"
}
both() { line "$(look TV mirror)"; line "$(look wall auto)"; }

if [[ "${1:-}" == "--fire" ]]; then
  shift
  guard_writes "fire $*"
  for ev in "$@"; do
    r="$(curl -fsS -X POST "$BASE/e/$event/api/mod/signal" -H "x-loom-token: $token" -H 'content-type: application/json' -d "{\"name\":\"$ev\"}")"
    sleep 1
    case "$r" in *'"refused":true'*) echo "── refused $ev (out of turn: # hosts says why)" ;; *) echo "── fired $ev" ;; esac; both
  done
  exit 0
fi

echo "event $event"
both
pngs=""
for s in screens_call_desktop tv_bingo tv_bingo_time screens_trivia_1 screens_trivia_2 screens_return screens_hunt_results screens_y2k screens_trust_chart screens_truth_txt; do
  # A missing file answers the app's index.html (200, text/html): only image/png counts.
  c=$(curl -s -o /dev/null -w '%{http_code} %{content_type}' "$BASE/terminal/slides/$s.png")
  [[ "$c" == "200 image/png"* ]] && pngs="$pngs $s"
done
echo "slide PNGs on the server:${pngs:- none yet (every slide shows its Win98 text card)}"

if [[ "${1:-}" == "--watch" ]]; then
  echo "watching every 2 s — Ctrl+C to stop"
  last=""
  while true; do
    now=$(both 2>/dev/null | sed -E 's/ [0-9]+s ago/ ·/; s/countdown=([a-z_0-9]+) [0-9]+/countdown=\1/g' || echo "poll failed")
    if [[ "$now" != "$last" ]]; then echo "── $(date +%H:%M:%S)"; both; last="$now"; fi
    sleep 2
  done
fi

cat <<'STEPS'

Device check (≤ 10 min) — the TV (house Mac's Chrome, full screen) + one wall tablet, preview event:
  0. TV: https://app.mapsandducks.com/terminal/?code=<mod code>&name=TV&character=Trabolta&view=mirror
     Tablet: …&name=Hall&character=Trabolta&spot=hall&view=auto   (both already provisioned after K-16 is fine)
  1. Run → header: Restart (Trabolta hidden). PASS: both on the idle show (screensavers, ads, popups).
  2. Laptop: MOD_CODE=<mod code> scripts/accept/K-17.sh --watch   (leave it running)
  3. Run → Director: fire call_to_the_desktop.
     PASS: TV + tablet show REPORT TO THE DESKTOP (PNG, or the grey Win98 card — never a broken
     image), the tablet goes back to the screensaver after 45 s, the TV after 90 s.
  4. Fire start_the_bingo. PASS: TV shows COMPUTER BINGO with a ⏱ 20:00 tray bottom right, and it
     STAYS (persistent) past 90 s; the tablet shows the screensaver with the ⏱ corner.
  5. Fire bingo_time. PASS: TV shows BINGO TIME (90 s), no corner.
  6. Fire introduce_trabolta, then start_the_hunt.
     PASS: both show TRABOLTA TRIVIA · ROUND 1 with Q1–Q3 AND a ⏱ 15:00 corner (the countdown cue
     did NOT replace the slide); the tablet returns to the face 45 s later, corner still ticking.
  7. Scan a pass on the tablet while a slide is up → the line opens over it (a pilot pre-empts a slide).
  8. Optional (needs the later beats; or trust the unit tests): hunt_time_up, first_moment_of_truth,
     close_the_filing, read_the_results ×3,
     second_hunt_preview, start_the_second_hunt (the cue sheet's order) → trivia_2 →
     the tablet back to auto at +45 s. A flicker: an admin flicker / Full Of Beans → one short
     stutter (2 dips, no strobe). Takeovers (blackout → GO TO THE LIVING ROOM) are rehearsed with
     the finale on 10-25: 10 s true black, then white text blinking once a second, no red field.
  Restart the story afterwards (Run → header) so the preview is clean.
STEPS
