#!/usr/bin/env bash
# K-16 — attract until Trabolta is revealed + the lean screen state (OCT31.md §5).
#
#   MOD_CODE=<mod passcode> scripts/accept/K-16.sh            one look at /api/screen/state
#   MOD_CODE=<mod passcode> scripts/accept/K-16.sh --watch    poll every 2 s, print each change
#                                                            with a timestamp (time the flip)
#   BASE=http://localhost:7000 MOD_CODE=… scripts/accept/K-16.sh   against a local server
#
# Desk part (automatic): the route answers with the mod code, says whether
# the terminals are on attract, and stays small. Device part (≤ 10 min) is
# printed at the end. Read-only: it polls with no terminal name, so it never
# lands in Run → Terminals (`/api/mod/screen/terminals`, the K-29 card) and
# writes nothing.
set -euo pipefail

BASE="${BASE:-https://app.mapsandducks.com}"
: "${MOD_CODE:?set MOD_CODE to the moderator passcode from the Run page}"

json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }

resolved=$(curl -fsS -X POST "$BASE/api/resolve-code" -H 'content-type: application/json' -d "{\"code\":\"$MOD_CODE\"}")
event=$(printf '%s' "$resolved" | json "d['eventId']")
role=$(printf '%s' "$resolved" | json "d['role']")
[[ "$role" == "mod" ]] || { echo "FAIL that code is a $role code, not the moderator passcode"; exit 1; }
token=$(curl -fsS -X POST "$BASE/e/$event/api/mod/login" -H 'content-type: application/json' -d "{\"passcode\":\"$MOD_CODE\"}" | json "d['token']")
url="$BASE/e/$event/api/screen/state?spot=&view=script&character=Trabolta"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/e/$event/api/screen/state")
[[ "$code" == "403" ]] && echo "OK  no token → 403" || { echo "FAIL no token → $code (expected 403)"; exit 1; }

look() { curl -fsS -H "x-loom-token: $token" "$url"; }
line() {
  printf '%s' "$1" | json "'attract=%s  hidden=%s awake=%s online=%s  Night.screen=%s Night.terminals=%s  cues=%s  countdown=%s remaining=%s' % (d['attract'], (d['character'] or {}).get('hidden'), (d['character'] or {}).get('awake'), (d['character'] or {}).get('online'), d['night']['screen'], d['night']['terminals'], ','.join('%s:%s' % (k, v['value']) for k, v in d['cues'].items() if v), d['countdown'], d['remaining'])"
}

body=$(look)
bytes=${#body}
echo "OK  event $event — $(line "$body")"
[[ $bytes -lt 2048 ]] && echo "OK  $bytes bytes" || echo "WARN $bytes bytes (aim ≈ 1 KB)"
# The heartbeats live on the director's own route since wave 17 (the screen
# state no longer carries them).
curl -fsS -H "x-loom-token: $token" "$BASE/e/$event/api/mod/screen/terminals" \
  | json "'    terminals seen: ' + (', '.join('%s (%s, %ss ago)' % (t['name'], t['view'], t['ago'] // 1000) for t in d['terminals']) or 'none')"

if [[ "${1:-}" == "--watch" ]]; then
  echo "watching every 2 s — Ctrl+C to stop"
  last=""
  while true; do
    now=$(line "$(look)" || echo "poll failed")
    key="${now% remaining=*}" # a running countdown alone isn't a change worth a line
    if [[ "$key" != "$last" ]]; then echo "$(date +%H:%M:%S)  $now"; last="$key"; fi
    sleep 2
  done
fi

cat <<'STEPS'

Device check (≤ 10 min) — one wall tablet, the preview event, nobody rehearsing on it.
Since wave 17 the server's attract flag still means "Trabolta is hidden or asleep"; what a
terminal draws while nobody is piloting it is the client's idle show (decision D1):
  1. Run → header: Restart (fresh story: Trabolta hidden). Above, expect attract=True hidden=True.
  2. Provision the tablet with view=auto FROM THE START:
       https://app.mapsandducks.com/terminal/?code=<mod code>&name=Hall&character=Trabolta&spot=hall&view=auto
     PASS (asleep): the idle show — screensavers that change (Mystify among them), fake-1999 ads,
     Win98 popups that pile up; tap a popup's buttons: most close it with a click, some open two
     more, jump away or ask "Are you sure?" first; tap a screensaver and it reacts. No camera light, no scan box, no "SCAN YOUR PASS",
     no "TRABOLTA" anywhere (no ad, popup or toast names him). Tap the screen once.
  3. Full screen: that first tap takes the page full screen (no browser bar). Leave it with the
     browser's own gesture, tap once more: full screen again. Run → Terminals: no ⛶ badge on Hall
     (⛶ = not full screen; a tablet that can't be, or has it off in ⚙, shows no badge at all).
     The TV (Chrome --kiosk, never tapped): no ⛶ on its row either; a ⛶ there means its Chrome
     was started without --kiosk (docs/trapped/kiosk.md → the TV).
  4. In a laptop terminal: MOD_CODE=<mod code> scripts/accept/K-16.sh --watch
  5. Run → Director: fire call_to_the_desktop, start_the_bingo, bingo_time.
     PASS: the tablet stays on the idle show (asleep: still no scan box, still no name);
     --watch shows countdown=bingo, then none.
  6. Fire introduce_trabolta. PASS: within 2 s --watch prints attract=False and the tablet keeps
     its idle show with the scanner shrunk to a corner scan box: the live camera, the reticle,
     SCAN YOUR PASS and "no camera? type your program name". His own popups may now name him. Popups and taps never
     cover the corner box.
  7. Hold a pass up to the corner box mid-show (or type a program name): the idle show steps
     aside and the line opens as before; DISCONNECT (or 30 s idle) brings the idle show back.
  8. Run → header: Restart → within 2 s the tablet is back on the asleep idle show, no scan box.
  Oldest tablet (10-20 tablet gate): step 2 with chrome://inspect open → no red Console errors,
  and the show stays smooth (no stutter for a full minute of screensavers and popups).
STEPS
