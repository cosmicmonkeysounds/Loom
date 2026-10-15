#!/usr/bin/env bash
# K-01 acceptance — the public VPS, checked from your laptop in ~2 minutes,
# then the one phone check (~5 minutes).
#
#   LOOM_MOD_CODE=<the preview's mod code> scripts/accept/k01.sh
#
# Env: LOOM_SERVER (default https://app.mapsandducks.com),
#      LOOM_INVITE (default https://mapsandducks.com),
#      LOOM_MOD_CODE (required: Run page → codes, or sync-show's output),
#      LOOM_SSE_SECONDS (default 60: long enough for two 25 s pings).
# Logs in as a moderator only — it registers no guest, changes nothing.
set -uo pipefail

SERVER="${LOOM_SERVER:-https://app.mapsandducks.com}"
INVITE="${LOOM_INVITE:-https://mapsandducks.com}"
SECS="${LOOM_SSE_SECONDS:-60}"
FAIL=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAIL=1; }

if [[ -z "${LOOM_MOD_CODE:-}" ]]; then
  echo "k01: set LOOM_MOD_CODE (the preview event's mod code — Run page, or sync-show output)" >&2
  exit 2
fi
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=process.argv[1].split(".").reduce((o,k)=>o?.[k],JSON.parse(s));process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }

echo "1. The three front doors answer over HTTPS"
for u in "$SERVER/" "$SERVER/edit/" "$INVITE/"; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "$u")"
  [[ "$code" == 200 ]] && ok "$u → 200" || bad "$u → $code"
done

echo "2. The join base is the public origin (joinBase + LOOM_BASE_URL)"
hit="$(curl -s -X POST -H 'content-type: application/json' -d "{\"code\":\"$LOOM_MOD_CODE\"}" "$SERVER/api/resolve-code")"
EID="$(printf '%s' "$hit" | json eventId)"
[[ -n "$EID" ]] && ok "mod code → event $EID" || { bad "resolve-code: $hit"; exit 1; }
TOKEN="$(curl -s -X POST -H 'content-type: application/json' -d "{\"passcode\":\"$LOOM_MOD_CODE\"}" "$SERVER/e/$EID/api/mod/login" | json token)"
[[ -n "$TOKEN" ]] && ok "mod login" || { bad "mod login failed"; exit 1; }
codes="$(curl -s -X POST -H 'content-type: application/json' -H "x-loom-token: $TOKEN" -d '{}' "$SERVER/e/$EID/api/mod/codes")"
JOIN="$(printf '%s' "$codes" | json joinUrl)"
GUEST="$(printf '%s' "$codes" | json eventPass)"
[[ "$JOIN" == "$SERVER" ]] && ok "/api/mod/codes joinUrl = $JOIN" || bad "/api/mod/codes joinUrl = '$JOIN' (want $SERVER — is LOOM_BASE_URL set and the image rebuilt?)"

echo "3. SSE is not compressed or buffered by Caddy (${SECS}s on the mod feed)"
hdr="$(curl -s -D - -o /dev/null --max-time 3 -H 'accept-encoding: gzip, zstd' "$SERVER/e/$EID/events?role=mod&token=$TOKEN" | tr -d '\r')"
if grep -qi '^content-encoding:' <<<"$hdr"; then bad "stream is compressed: $(grep -i '^content-encoding:' <<<"$hdr")"; else ok "no content-encoding on the stream"; fi
start=$(date +%s); pings=0; last=$start; late=0
while IFS= read -r line; do
  now=$(date +%s)
  if [[ "$line" == ":ping" ]]; then
    pings=$((pings + 1)); gap=$((now - last)); last=$now
    echo "    :ping at +$((now - start))s (gap ${gap}s)"
    (( gap > 30 )) && late=1
  fi
done < <(curl -sN --max-time "$SECS" -H 'accept-encoding: gzip, zstd' "$SERVER/e/$EID/events?role=mod&token=$TOKEN" 2>/dev/null)
if (( SECS >= 55 )); then
  (( pings >= 2 && late == 0 )) && ok "$pings pings, each ≤ 30 s apart" || bad "$pings pings in ${SECS}s (want ≥ 2, ≤ 30 s apart)"
fi

echo
(( FAIL == 0 )) && echo "Laptop checks green." || echo "Laptop checks FAILED — fix before the phone check."
cat <<EOF

Phone check (an iPhone with Wi-Fi OFF, ~5 min):
  1. Scan the Run page's join QR (editor → Run → codes) — or open:
       $SERVER/?code=$GUEST
  2. It must land on $SERVER (not an IP), pick a program, register.
  3. The Optical Drive cutscene plays; solve the CAPTCHA.
  4. Uptime: stop the container (docker compose stop loom on the VPS) —
     your phone, the tech op's and the second director's get paged; start it again.
EOF
exit $FAIL
