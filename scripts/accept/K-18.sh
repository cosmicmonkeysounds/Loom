#!/usr/bin/env bash
# K-18 (+ N-04b) — the TV room voice (OCT31.md §5).
#
#   MOD_CODE=<mod passcode> scripts/accept/K-18.sh               the TV's voice block now
#                                                                (room, mute, head seq)
#   MOD_CODE=… scripts/accept/K-18.sh --watch                    poll like the TV (every 1 s, with
#                                                                its cursor) and print each new line
#                                                                + what the TV does with it
#   MOD_CODE=… scripts/accept/K-18.sh --say "text"               a director `say` as Trabolta in
#                                                                The Desktop (the ceremony path)
#   MOD_CODE=… scripts/accept/K-18.sh --beat "Song Ending"       fire a beat directly (the song)
#   MOD_CODE=… scripts/accept/K-18.sh --fire <event> [...]       fire named events
#   MOD_CODE=… scripts/accept/K-18.sh --mute on|off              the director's TV-voice mute
#   BASE=http://localhost:7000 MOD_CODE=… scripts/accept/K-18.sh  against a local server
#
# The watcher polls with no terminal name (view=tv), so it never lands in the route's
# `terminals` list (the K-29 card). --say / --beat / --fire / --mute WRITE to the event:
# they run the live guard first (refuses a roster with real guests unless
# --i-know-this-is-live; asks y/N unless --yes or localhost).
set -euo pipefail
source "$(dirname "$0")/guard.sh" "$@"; set -- ${ARGS[@]+"${ARGS[@]}"}

BASE="${BASE:-https://app.mapsandducks.com}"
ROOM="${ROOM:-The Desktop}"
: "${MOD_CODE:?set MOD_CODE to the moderator passcode from the Run page}"

json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
post() { curl -fsS -X POST "$BASE/e/$event$1" -H "x-loom-token: $token" -H 'content-type: application/json' -d "$2"; }
jstr() { python3 -I -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }

resolved=$(curl -fsS -X POST "$BASE/api/resolve-code" -H 'content-type: application/json' -d "{\"code\":\"$MOD_CODE\"}")
event=$(printf '%s' "$resolved" | json "d['eventId']")
role=$(printf '%s' "$resolved" | json "d['role']")
[[ "$role" == "mod" ]] || { echo "FAIL that code is a $role code, not the moderator passcode"; exit 1; }
token=$(curl -fsS -X POST "$BASE/e/$event/api/mod/login" -H 'content-type: application/json' -d "{\"passcode\":\"$MOD_CODE\"}" | json "d['token']")
room_q=$(python3 -I -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$ROOM")

look() { curl -fsS -H "x-loom-token: $token" "$BASE/e/$event/api/screen/state?spot=&view=tv&character=Trabolta&voice=$room_q${1:+&after=$1}"; }

case "${1:-}" in
  --say|--beat|--fire|--mute) guard_writes "${1#--} ${*:2}" ;;
esac

case "${1:-}" in
  --say)
    post /api/mod/say "{\"as\":\"Trabolta\",\"channel\":\"loc:$ROOM\",\"text\":$(jstr "${2:?--say needs the text}")}" > /dev/null
    echo "said as Trabolta in $ROOM: $2"; exit 0 ;;
  --beat)
    post /api/mod/beat "{\"name\":$(jstr "${2:?--beat needs a beat name}")}" > /dev/null
    echo "fired beat $2"; exit 0 ;;
  --fire)
    shift
    for ev in "$@"; do post /api/mod/signal "{\"name\":$(jstr "$ev")}" > /dev/null; echo "fired $ev"; sleep 1; done
    exit 0 ;;
  --mute)
    case "${2:-}" in on) m=true ;; off) m=false ;; *) echo "--mute on|off"; exit 1 ;; esac
    echo "muted: $(post /api/mod/screen/voice "{\"muted\":$m}" | json "d['muted']")"; exit 0 ;;
esac

echo "event $event"
look "" | json "'room=%r muted=%s head=%s attract=%s' % (d['voice']['room'], d['voice']['muted'], d['voice']['head'], d['attract'])"
[[ "$(look "" | json "d['voice']['room']")" != "" ]] || echo "FAIL the story has no LOCATION named '$ROOM'"
tts=$(curl -fsS -H "x-loom-token: $token" "$BASE/e/$event/api/mod/tts" | json "'server voice: %s (%s, default %s)' % ('ON (opt-in)' if d.get('available') else 'OFF (the default) — the TV speaks with the macOS voice in Chrome', d.get('model'), d.get('voice'))" || echo "server voice: unknown")
echo "$tts"

if [[ "${1:-}" == "--watch" ]]; then
  echo "watching like the TV (every 1 s) — Ctrl+C to stop"
  cursor=$(look "" | json "d['voice']['head']")
  while true; do
    out=$(look "$cursor" 2>/dev/null || echo "")
    if [[ -n "$out" ]]; then
      printf '%s' "$out" | python3 -I -c "
import json,sys,time
d=json.load(sys.stdin); v=d['voice']; silent={'song ending','sad confession','the hand jive'}
for l in v['lines']:
    b=(l['beat'] or '').lower().replace('_',' ')
    if d['attract']: what='DROPPED (attract)'
    elif l['from'].lower()=='trabolta': what='CAPTION ONLY (song beat)' if b in silent else ('CAPTION ONLY (muted)' if v['muted'] else 'SPOKEN')
    elif l['from'].lower()=='sandy': what='CAPTION ONLY (Sandy is lore)'
    else: what='ignored'
    print('%s #%s %-28s %s: %s  [%s]' % (time.strftime('%H:%M:%S'), l['seq'], what, l['from'], l['text'][:70], l['beat'] or 'director say'))
"
      cursor=$(printf '%s' "$out" | json "d['voice']['head']")  # a lower head = a restart: resync
    fi
    sleep 1
  done
fi

cat <<'STEPS'

Device check (≤ 10 min) — the TV on the house Mac, the preview event:
  0. House Mac Chrome (full screen, launched with --autoplay-policy=no-user-gesture-required):
     https://app.mapsandducks.com/terminal/?code=<mod code>&name=TV&character=Trabolta&spot=desktop-tv&view=tv
     Sound out of the MOTU's living-room pair. A laptop runs: MOD_CODE=<mod code> scripts/accept/K-18.sh --watch
  1. Run → header: Restart. PASS: the TV shows the screensaver (Trabolta hidden).
  2. scripts/accept/K-18.sh --fire call_to_the_desktop start_the_bingo bingo_time introduce_trabolta
     PASS: within 3 s of introduce_trabolta the TV shows his face and SAYS "HELLO, PROGRAMS…"
     (mouth moving with the audio, caption under it); Clippy's lines are NOT spoken.
  3. scripts/accept/K-18.sh --say "Testing. This is Trabolta, live from the director's desk."
     PASS: spoken within 3 s.
  4. scripts/accept/K-18.sh --beat "Song Ending"   (QLab plays the vocoder track via stagehand)
     PASS: the song plays, the TV only CAPTIONS Trabolta's sung lines + Sandy's line — no TTS on top.
  5. Press M on the TV keyboard (or scripts/accept/K-18.sh --mute on), then --say "You should not hear this."
     PASS: caption only, the button reads 🔇 VOICE MUTED. Unmute (M / --mute off) → --say "Back." is spoken.
  6. Reboot the house Mac (or quit + relaunch Chrome WITHOUT the flag), reopen the TV URL, click once
     anywhere on the page, then --say "After the reboot."  PASS: spoken.
  Restart the story afterwards (Run → header) so the preview is clean.
STEPS
