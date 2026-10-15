#!/usr/bin/env bash
# K-31a acceptance — push to locked Android phones + an Antivirus booth.
# ~10 minutes. Needs the server running a build that includes K-31a, WITH
# VAPID keys in its env, on a REHEARSAL (never the live show).
#
#   LOOM_MOD_CODE=<rehearsal mod code> scripts/accept/k31a.sh
#
# Keys, once (never rotate them before the party):
#   npx web-push generate-vapid-keys
#   → LOOM_VAPID_PUBLIC_KEY / LOOM_VAPID_PRIVATE_KEY in the VPS .env,
#     then `docker compose up -d loom`.
#
# You need: 2 Android phones (Chrome) and a third device — ideally a third
# Android — for the Antivirus booth. Over HTTPS only (push needs it).
#
# Checks (the plan's acceptance, OCT31.md §5 K-31a):
#   A. app in the foreground: a `!` alert banners in-app, NO duplicate
#      system notification;
#   B. both guest phones LOCKED, Wi-Fi OFF (cellular): a `!` alert arrives
#      as a notification;
#   C. same: a Trabolta DM arrives as a notification;
#   D. the Antivirus booth, locked: the door alarm ("🚨 Server room
#      breach") arrives as a notification.
#
# Env: LOOM_SERVER (default https://app.mapsandducks.com),
#      K31_YES=1 skips the "is this a rehearsal?" prompt.
set -uo pipefail

SERVER="${LOOM_SERVER:-https://app.mapsandducks.com}"
: "${LOOM_MOD_CODE:?set LOOM_MOD_CODE to the rehearsal mod code (Run page → codes)}"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));process.stdout.write(v==null?"":typeof v==="object"?JSON.stringify(v):String(v))}catch{}})' "$1"; }
post() { curl -s -X POST -H 'content-type: application/json' ${TOKEN:+-H "x-loom-token: $TOKEN"} -d "$2" "$SERVER/e/$EID$1"; }
FAIL=0
ask() { # ask "<question>" → records ✓/✗
  local yn
  read -r -p "    $1 [y/n] " yn
  if [[ "$yn" == "y" || "$yn" == "Y" ]]; then echo "  ✓ $1"; else echo "  ✗ $1"; FAIL=1; fi
}
# One line per subscribed owner: "<guest|booth> <devices> <hidden> <id|character> [name]".
status_lines() {
  post /api/mod/push/status '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s||"{}");for(const g of v.guests??[])console.log(["guest",g.devices,g.hidden,g.id,g.name??""].join(" "));for(const b of v.booths??[])console.log(["booth",b.devices,b.hidden,b.character].join(" "))})'
}

hit="$(curl -s -X POST -H 'content-type: application/json' -d "{\"code\":\"$LOOM_MOD_CODE\"}" "$SERVER/api/resolve-code")"
EID="$(printf '%s' "$hit" | json eventId)"
[[ -n "$EID" ]] || { echo "k31a: $LOOM_MOD_CODE did not resolve on $SERVER: $hit" >&2; exit 1; }
TITLE="$(printf '%s' "$hit" | json title)"
TOKEN=""
TOKEN="$(post /api/mod/login "{\"passcode\":\"$LOOM_MOD_CODE\"}" | json token)"
[[ -n "$TOKEN" ]] || { echo "k31a: mod login failed" >&2; exit 1; }
cfg="$(curl -s "$SERVER/e/$EID/api/push/config")"
if [[ "$(printf '%s' "$cfg" | json enabled)" != "true" ]]; then
  echo "k31a: push is OFF on $SERVER ($cfg)." >&2
  echo "      Put LOOM_VAPID_PUBLIC_KEY / LOOM_VAPID_PRIVATE_KEY (npx web-push generate-vapid-keys) in the VPS .env and restart the loom service." >&2
  exit 1
fi
codes="$(post /api/mod/codes '{}')"
GUEST_CODE="$(printf '%s' "$codes" | json eventPass)"
PRIME_CODE="$(printf '%s' "$codes" | json primePass)"
if [[ "${K31_YES:-}" != "1" ]]; then
  read -r -p "Run the push checks on \"$TITLE\" ($EID)? It must be a rehearsal, not the live show. [y/N] " yn
  [[ "$yn" == "y" || "$yn" == "Y" ]] || exit 1
fi

echo
echo "Setup (Chrome on each Android, Wi-Fi still on is fine for now):"
echo "  • Booth: open $SERVER/?code=${PRIME_CODE:-<performer code>}, sign in as an ANTIVIRUS part"
echo "    (Norton, McAfee…), tap 🔔 Get alerts → Turn on → Allow."
echo "  • Guest phones 1 + 2: open $SERVER/?code=$GUEST_CODE, pick a program, solve the"
echo "    CAPTCHA; the booth scans each pass (My pass) to let them out of the Mud Room;"
echo "    then tap 🔔 Get alerts → Turn on → Allow."
read -r -p "Press Enter when all three show \"Alerts are on\" in ☰ / the profile sheet… " _
echo "  Subscribed now:"
lines="$(status_lines)"
printf '%s\n' "$lines" | sed 's/^/    /'
GUESTS=($(printf '%s\n' "$lines" | awk '$1=="guest"{print $4}'))
BOOTHS="$(printf '%s\n' "$lines" | awk '$1=="booth"' | wc -l | tr -d ' ')"
[[ ${#GUESTS[@]} -ge 2 ]] && echo "  ✓ ${#GUESTS[@]} guest phone(s) subscribed" || { echo "  ✗ want 2 guest phones subscribed, have ${#GUESTS[@]}"; FAIL=1; }
[[ "$BOOTHS" -ge 1 ]] && echo "  ✓ $BOOTHS booth(s) subscribed" || { echo "  ✗ no booth subscribed"; FAIL=1; }

echo
echo "A. Keep every app OPEN and in front."
STAMP="$(date +%H:%M:%S)"
post /api/mod/broadcast "{\"scope\":\"all\",\"cue\":\"!K-31a foreground $STAMP\"}" >/dev/null
ask "Every device: the in-app banner \"K-31a foreground $STAMP\" — and NO system notification for it?"

echo
echo "B–D. Now LOCK all three phones and turn Wi-Fi OFF on both guest phones (cellular)."
echo "     Waiting for each phone to report itself hidden (the sendBeacon)…"
for ((s = 0; s < 90; s += 5)); do
  lines="$(status_lines)"
  open="$(printf '%s\n' "$lines" | awk '$2>$3' | wc -l | tr -d ' ')"
  [[ "$open" == "0" ]] && break
  printf '    %d device owner(s) still showing the app…\r' "$open"; sleep 5
done
printf '%s\n' "$lines" | sed 's/^/    /'
[[ "$open" == "0" ]] && echo "  ✓ every phone reported hidden" || echo "  (some phone never reported hidden — DMs/readouts to it will not push; alerts still will)"
sleep 20 # let the radios settle on cellular

STAMP="$(date +%H:%M:%S)"
res="$(post /api/mod/broadcast "{\"scope\":\"all\",\"cue\":\"!🔔 K-31a alert $STAMP\"}")"
[[ "$(printf '%s' "$res" | json ok)" == "true" ]] && echo "  ✓ sent \"🔔 K-31a alert $STAMP\"" || { echo "  ✗ broadcast: $res"; FAIL=1; }
ask "B. Both LOCKED guest phones (cellular): a notification \"K-31a alert $STAMP\"?"

for id in "${GUESTS[@]}"; do
  post /api/mod/say "{\"as\":\"Trabolta\",\"channel\":\"guest:$id\",\"text\":\"K-31a: are you there, program? ($STAMP)\"}" >/dev/null
done
echo "  ✓ sent a Trabolta DM to each subscribed guest"
ask "C. Both LOCKED guest phones: a \"Trabolta\" notification \"K-31a: are you there…\"?"

res="$(post /api/mod/signal '{"name":"alarm_tripped"}')"
[[ "$(printf '%s' "$res" | json ok)" == "true" ]] && echo "  ✓ fired alarm_tripped (every Antivirus booth's door alarm)" || { echo "  ✗ signal: $res"; FAIL=1; }
ask "D. The LOCKED Antivirus booth: a notification \"🚨 Server room breach…\"?"

echo
echo "Tap a notification: it should open / focus the app. Turn Wi-Fi back on."
echo "Afterwards: restart the rehearsal to clear the test programs."
echo
if [[ $FAIL -eq 0 ]]; then echo "K-31a: PASS"; else echo "K-31a: FAIL (see ✗ above)"; fi
exit $FAIL
