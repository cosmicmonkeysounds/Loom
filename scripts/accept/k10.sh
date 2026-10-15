#!/usr/bin/env bash
# K-10 acceptance — codes survive End → relaunch (~5 minutes, needs the VPS
# running a build that includes K-10).
#
#   1. LOOM_EVENT_CODE=… LOOM_PRIME_CODE=… LOOM_MOD_CODE=… scripts/accept/k10.sh before
#   2. In the editor (/edit/ → the show project → Run): ■ End, then Start
#      rehearsal (or Go live) again.
#   3. scripts/accept/k10.sh after
#   4. Scan a printed (or on-screen) test QR from step 1 with a phone on
#      cellular: it must open the join screen of the relaunched event.
#
# Env: LOOM_SERVER (default https://app.mapsandducks.com). Codes come from the
# Run page. Only calls /api/resolve-code — registers nobody, changes nothing.
set -uo pipefail

SERVER="${LOOM_SERVER:-https://app.mapsandducks.com}"
STATE="${TMPDIR:-/tmp}/loom-k10.state"
FAIL=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAIL=1; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }
resolve() { curl -s -X POST -H 'content-type: application/json' -d "{\"code\":\"$1\"}" "$SERVER/api/resolve-code"; }

case "${1:-}" in
  before)
    : "${LOOM_EVENT_CODE:?set LOOM_EVENT_CODE}" "${LOOM_PRIME_CODE:?set LOOM_PRIME_CODE}" "${LOOM_MOD_CODE:?set LOOM_MOD_CODE}"
    EID="$(resolve "$LOOM_EVENT_CODE" | json eventId)"
    [[ -n "$EID" ]] || { echo "k10: event code does not resolve on $SERVER" >&2; exit 1; }
    printf 'EVENT=%s\nPRIME=%s\nMOD=%s\nEID=%s\n' "$LOOM_EVENT_CODE" "$LOOM_PRIME_CODE" "$LOOM_MOD_CODE" "$EID" > "$STATE"
    ok "recorded event $EID"
    echo "  Test QR: $SERVER/?code=$LOOM_EVENT_CODE"
    echo "  Now ■ End the run in the editor, start it again, then: $0 after"
    ;;
  after)
    [[ -f "$STATE" ]] || { echo "k10: run '$0 before' first" >&2; exit 2; }
    # shellcheck disable=SC1090
    source "$STATE"
    for pair in "EVENT:guest" "PRIME:prime" "MOD:mod"; do
      var="${pair%%:*}"; want="${pair##*:}"; code="${!var}"
      hit="$(resolve "$code")"
      role="$(printf '%s' "$hit" | json role)"; eid="$(printf '%s' "$hit" | json eventId)"
      if [[ "$role" != "$want" ]]; then bad "$var code $code → ${hit:-no answer} (want role $want)"
      elif [[ "$eid" == "$EID" ]]; then bad "$var code still resolves to the OLD event $EID — did you End + relaunch?"
      else ok "$var code $code → $want on the new event $eid"; fi
    done
    echo "  Phone (cellular): scan the test QR → $SERVER/?code=$EVENT → the join screen loads."
    ;;
  *) echo "usage: $0 before|after" >&2; exit 2 ;;
esac
exit $FAIL
