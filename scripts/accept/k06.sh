#!/usr/bin/env bash
# K-06 (+ N-07) acceptance — alerts that actually land. ~8 minutes, needs the
# server running a build that includes K-06, on a REHEARSAL (never the live
# show: this registers one throwaway guest, "K06 Late").
#
#   LOOM_MOD_CODE=<rehearsal mod code> scripts/accept/k06.sh
#
# You need: an iPhone and an Android phone joined as guests (open
# <server>/?code=<guest code>, pick a program), and one more phone or a
# laptop browser signed in as an ANTIVIRUS part (<server>/?code=<performer
# code>). Tap each app once after it opens (that unlocks sound).
#
# The script then walks you through three checks:
#   A. screen off 2 min on both phones → `!` alert → banner + chime on wake
#      (iPhone never vibrates; the banner + chime are the pass);
#   B. the Antivirus booth chimes + banners the same `!` alert;
#   C. the Antivirus booth chimes + banners "⏰ K06 Late is late…" (N-07).
#
# Env: LOOM_SERVER (default https://app.mapsandducks.com),
#      K06_WAIT (default 120: seconds the phones stay locked before the alert),
#      K06_YES=1 skips the "is this a rehearsal?" prompt.
set -uo pipefail

SERVER="${LOOM_SERVER:-https://app.mapsandducks.com}"
WAIT="${K06_WAIT:-120}"
: "${LOOM_MOD_CODE:?set LOOM_MOD_CODE to the rehearsal mod code (Run page → codes)}"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }
post() { curl -s -X POST -H 'content-type: application/json' ${TOKEN:+-H "x-loom-token: $TOKEN"} -d "$2" "$SERVER/e/$EID$1"; }
FAIL=0
ask() { # ask "<question>" → records ✓/✗
  local yn
  read -r -p "    $1 [y/n] " yn
  if [[ "$yn" == "y" || "$yn" == "Y" ]]; then echo "  ✓ $1"; else echo "  ✗ $1"; FAIL=1; fi
}

hit="$(curl -s -X POST -H 'content-type: application/json' -d "{\"code\":\"$LOOM_MOD_CODE\"}" "$SERVER/api/resolve-code")"
EID="$(printf '%s' "$hit" | json eventId)"
[[ -n "$EID" ]] || { echo "k06: $LOOM_MOD_CODE did not resolve on $SERVER: $hit" >&2; exit 1; }
TITLE="$(printf '%s' "$hit" | json title)"
TOKEN=""
TOKEN="$(post /api/mod/login "{\"passcode\":\"$LOOM_MOD_CODE\"}" | json token)"
[[ -n "$TOKEN" ]] || { echo "k06: mod login failed" >&2; exit 1; }
codes="$(post /api/mod/codes '{}')"
GUEST_CODE="$(printf '%s' "$codes" | json eventPass)"
if [[ "${K06_YES:-}" != "1" ]]; then
  read -r -p "Run the alert checks on \"$TITLE\" ($EID)? It must be a rehearsal, not the live show. [y/N] " yn
  [[ "$yn" == "y" || "$yn" == "Y" ]] || exit 1
fi

echo
echo "Setup: both phones joined as guests ($SERVER/?code=$GUEST_CODE), the third"
echo "device signed in as an Antivirus part. Tap each app once."
read -r -p "Press Enter when all three are open and tapped… " _

echo
echo "A + B. Lock the iPhone and the Android NOW (screen off). Leave the booth open."
for ((s = WAIT; s > 0; s -= 10)); do printf '    %3ds left\r' "$s"; sleep 10; done
STAMP="$(date +%H:%M:%S)"
res="$(post /api/mod/broadcast "{\"scope\":\"all\",\"cue\":\"!🔔 K-06 test alert $STAMP\"}")"
[[ "$(printf '%s' "$res" | json ok)" == "true" ]] && echo "  ✓ sent \"🔔 K-06 test alert $STAMP\"" || { echo "  ✗ broadcast: $res"; FAIL=1; }
ask "Antivirus booth: banner \"K-06 test alert $STAMP\" + chime right away?"
echo "    Now wake both phones (unlock, bring the app to the front)."
ask "iPhone: banner \"K-06 test alert $STAMP\" + chime on wake?"
ask "Android: banner \"K-06 test alert $STAMP\" + chime (+ buzz) on wake?"

echo
echo "C. The late list (N-07): a throwaway guest is late; every Antivirus booth hears it."
reg="$(post /api/guest/register "{\"passcode\":\"$GUEST_CODE\",\"name\":\"K06 Late\"}")"
LATE="$(printf '%s' "$reg" | json id)"
if [[ -z "$LATE" ]]; then
  echo "  ✗ could not register the throwaway guest: $reg"; FAIL=1
else
  res="$(post /api/mod/signal "{\"name\":\"program_late\",\"subject\":\"$LATE\"}")"
  [[ "$(printf '%s' "$res" | json ok)" == "true" ]] && echo "  ✓ fired program_late for $LATE" || { echo "  ✗ signal: $res"; FAIL=1; }
  ask "Antivirus booth: banner \"⏰ K06 Late is late for the Second Moment of Truth…\" + chime?"
fi

echo
echo "Optional: ☰ → Keep my screen on, on one phone; it should not sleep for 2 min."
echo "Afterwards: restart the rehearsal to clear \"K06 Late\"."
echo
if [[ $FAIL -eq 0 ]]; then echo "K-06: PASS"; else echo "K-06: FAIL (see ✗ above)"; fi
exit $FAIL
