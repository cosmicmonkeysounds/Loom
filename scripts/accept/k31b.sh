#!/usr/bin/env bash
# K-31b acceptance — iPhone Home Screen push. ~15 minutes. Needs the server
# running a build with K-31b, VAPID keys AND `LOOM_HOMESCREEN=on` in its env,
# on a REHEARSAL (never the live show). Run k31a.sh first: no-go on Android
# = leave LOOM_HOMESCREEN off.
#
#   LOOM_MOD_CODE=<rehearsal mod code> scripts/accept/k31b.sh
#
# You need: 2 iPhones on iOS 16.4+ (Safari) for guests, a third iPhone for an
# Antivirus booth, and ideally one iPhone below 16.4 (or any iPhone with the
# switch off) for the "keep the app open" card. HTTPS only.
#
# Checks (OCT31.md §5 K-31b):
#   A. the server says homescreen on, the nonce manifest + touch icon serve;
#   B. an iPhone guest tab shows "Get alerts on your iPhone"; after Add to
#      Home Screen the icon opens AS THE SAME PROGRAM (no second program);
#   C. 🔔 Turn on inside the icon, the Safari tab still works;
#   D. LOCKED, Wi-Fi off: a `!` alert and a Trabolta DM arrive;
#   E. reopening the icon does not ask "switch this phone?";
#   F. the booth: Sign out in Safari → sign in from its icon → locked door
#      alarm arrives.
#
# Env: LOOM_SERVER (default https://app.mapsandducks.com), K31_YES=1.
set -uo pipefail

SERVER="${LOOM_SERVER:-https://app.mapsandducks.com}"
: "${LOOM_MOD_CODE:?set LOOM_MOD_CODE to the rehearsal mod code (Run page → codes)}"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));process.stdout.write(v==null?"":typeof v==="object"?JSON.stringify(v):String(v))}catch{}})' "$1"; }
post() { curl -s -X POST -H 'content-type: application/json' ${TOKEN:+-H "x-loom-token: $TOKEN"} -d "$2" "$SERVER/e/$EID$1"; }
FAIL=0
ok() { echo "  ✓ $1"; }
bad() { echo "  ✗ $1"; FAIL=1; }
ask() {
  local yn
  read -r -p "    $1 [y/n] " yn
  if [[ "$yn" == "y" || "$yn" == "Y" ]]; then ok "$1"; else bad "$1"; fi
}

hit="$(curl -s -X POST -H 'content-type: application/json' -d "{\"code\":\"$LOOM_MOD_CODE\"}" "$SERVER/api/resolve-code")"
EID="$(printf '%s' "$hit" | json eventId)"
[[ -n "$EID" ]] || { echo "k31b: $LOOM_MOD_CODE did not resolve on $SERVER: $hit" >&2; exit 1; }
TITLE="$(printf '%s' "$hit" | json title)"
TOKEN=""
TOKEN="$(post /api/mod/login "{\"passcode\":\"$LOOM_MOD_CODE\"}" | json token)"
[[ -n "$TOKEN" ]] || { echo "k31b: mod login failed" >&2; exit 1; }

echo "A. Server"
cfg="$(curl -s "$SERVER/e/$EID/api/push/config")"
[[ "$(printf '%s' "$cfg" | json enabled)" == "true" ]] && ok "push keys set" || bad "push is OFF ($cfg) — set the VAPID keys"
[[ "$(printf '%s' "$cfg" | json homescreen)" == "true" ]] && ok "LOOM_HOMESCREEN is on" || { bad "homescreen is off ($cfg) — LOOM_HOMESCREEN=on in .env, restart loom"; exit 1; }
man="$(curl -s "$SERVER/manifest.webmanifest?code=PROBE&pair=probe123")"
[[ "$(printf '%s' "$man" | json start_url)" == "/?code=PROBE&pair=probe123&home=1" ]] && ok "the nonce manifest carries start_url" || bad "nonce manifest: $man"
[[ "$(curl -s "$SERVER/manifest.webmanifest" | json start_url)" == "/" ]] && ok "the plain manifest is unchanged (Android)" || bad "the plain manifest changed"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$SERVER/apple-touch-icon.png")" == "200" ]] && ok "touch icon serves" || bad "no /apple-touch-icon.png (rebuild play)"

codes="$(post /api/mod/codes '{}')"
GUEST_CODE="$(printf '%s' "$codes" | json eventPass)"
PRIME_CODE="$(printf '%s' "$codes" | json primePass)"
if [[ "${K31_YES:-}" != "1" ]]; then
  read -r -p "Run the iPhone checks on \"$TITLE\" ($EID)? It must be a rehearsal, not the live show. [y/N] " yn
  [[ "$yn" == "y" || "$yn" == "Y" ]] || exit 1
fi

echo
echo "B. Each guest iPhone, in Safari: open $SERVER/?code=$GUEST_CODE, pick a program, get"
echo "   cleared at the door. Note the program's name."
ask "B1. The card above the rooms reads \"Get alerts on your iPhone — tap Share → Add to Home Screen…\"?"
echo "   Now: Share → Add to Home Screen → Add, then open the new icon."
ask "B2. The icon opens signed in as the SAME program (same name, same score) — not the join screen?"
ask "C. In the icon: 🔔 Get alerts → Turn on → Allow; ☰ shows \"Alerts are on\". The Safari tab still loads too?"

echo
echo "D. LOCK both guest iPhones, Wi-Fi OFF (cellular). Waiting 30 s…"
sleep 30
STAMP="$(date +%H:%M:%S)"
res="$(post /api/mod/broadcast "{\"scope\":\"all\",\"cue\":\"!🔔 K-31b alert $STAMP\"}")"
[[ "$(printf '%s' "$res" | json ok)" == "true" ]] && ok "sent \"🔔 K-31b alert $STAMP\"" || bad "broadcast: $res"
ask "D1. Both LOCKED iPhones: a notification \"K-31b alert $STAMP\"?"
GUESTS=($(post /api/mod/push/status '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{for(const g of JSON.parse(s||"{}").guests??[])console.log(g.id)})'))
for id in "${GUESTS[@]}"; do
  post /api/mod/say "{\"as\":\"Trabolta\",\"channel\":\"guest:$id\",\"text\":\"K-31b: are you there, program? ($STAMP)\"}" >/dev/null
done
ok "sent a Trabolta DM to ${#GUESTS[@]} subscribed guest(s)"
ask "D2. Both LOCKED iPhones: a \"Trabolta\" notification; tapping it opens the Trabolta chat?"
ask "E. Close the icon app fully (swipe it away) and reopen it: straight back in, NO \"switch this phone?\" question?"

echo
echo "F. Booth iPhone, Safari: open $SERVER/?code=${PRIME_CODE:-<performer code>}, sign in as an ANTIVIRUS part."
ask "F1. Its card reads \"…then ☰ → Sign out, and sign in from the Home Screen icon\"?"
echo "   Share → Add to Home Screen; in Safari ☰ → Sign out; open the icon, sign in as the same part (no \"taken\"),"
echo "   🔔 Turn on → Allow; lock it. (Stuck on \"taken\"? Run → ⏏ Release the part.)"
read -r -p "Press Enter when the booth icon is signed in, alerts on, and locked… " _
res="$(post /api/mod/signal '{"name":"alarm_tripped"}')"
[[ "$(printf '%s' "$res" | json ok)" == "true" ]] && ok "fired alarm_tripped" || bad "signal: $res"
ask "F2. The LOCKED booth iPhone: a notification \"🚨 Server room breach…\"?"

echo
echo "G. (optional) An iPhone below 16.4: open $SERVER/?code=$GUEST_CODE and join."
ask "G. Its card reads \"Your iPhone can't get alerts — keep … open with the screen on\"? (n if skipped)"
echo "Turn Wi-Fi back on. Afterwards: restart the rehearsal to clear the test programs."
echo
if [[ $FAIL -eq 0 ]]; then echo "K-31b: PASS"; else echo "K-31b: FAIL (see ✗ above)"; fi
exit $FAIL
