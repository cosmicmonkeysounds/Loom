#!/usr/bin/env bash
# N-01 acceptance — the booth Scanner reads passes on an iPhone (Safari, jsQR
# fallback) and on Android (native BarcodeDetector). ~8 minutes, needs the
# server running a build that includes N-01.
#
#   1. Start a REHEARSAL in the editor (Run → Start rehearsal). Never a live
#      show: this registers 10 throwaway guests ("N01 Pass 1…10").
#   2. LOOM_EVENT_CODE=<guest code> scripts/accept/n01.sh
#      → opens a sheet of 10 pass QRs on this Mac's screen.
#   3. iPhone (Safari) over HTTPS: <server>/?code=<performer code> → sign in as
#      an Antivirus → Scanner → 📷 Use camera → allow the camera. Hold the
#      phone to pass 1, 2, … 10 WITHOUT touching the screen between passes.
#      Each pass must add a "✓ g-…" line and a readout. 10/10 = pass.
#   4. Repeat step 3 on an Android phone (Chrome), signed in as another part.
#   5. Restart the rehearsal to clear the 10 test guests.
#
# Env: LOOM_SERVER (default https://app.mapsandducks.com).
set -uo pipefail

SERVER="${LOOM_SERVER:-https://app.mapsandducks.com}"
: "${LOOM_EVENT_CODE:?set LOOM_EVENT_CODE to the rehearsal guest code}"
OUT="${TMPDIR:-/tmp}/loom-n01-passes.html"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }
post() { curl -s -X POST -H 'content-type: application/json' -d "$2" "$1"; }

body='{"code":"'"$LOOM_EVENT_CODE"'"}'
hit="$(post "$SERVER/api/resolve-code" "$body")"
EID="$(printf '%s' "$hit" | json eventId)"
ROLE="$(printf '%s' "$hit" | json role)"
[[ -n "$EID" && "$ROLE" == "guest" ]] || { echo "n01: $LOOM_EVENT_CODE is not a guest code on $SERVER: $hit" >&2; exit 1; }
TITLE="$(printf '%s' "$hit" | json title)"
if [[ "${N01_YES:-}" != "1" ]]; then
  read -r -p "Register 10 test guests on \"$TITLE\" ($EID)? It must be a rehearsal, not the live show. [y/N] " yn
  [[ "$yn" == "y" || "$yn" == "Y" ]] || exit 1
fi

cells=""
n=0
for i in $(seq 1 10); do
  body='{"passcode":"'"$LOOM_EVENT_CODE"'","name":"N01 Pass '"$i"'"}'
  res="$(post "$SERVER/e/$EID/api/guest/register" "$body")"
  id="$(printf '%s' "$res" | json id)"
  if [[ -z "$id" ]]; then echo "  ✗ pass $i: $res" >&2; continue; fi
  n=$((n + 1))
  echo "  ✓ pass $i → $id"
  cells+="<figure><img src=\"$SERVER/api/qr?text=$id\" alt=\"$id\"><figcaption>$i · $id</figcaption></figure>"
done
[[ $n -gt 0 ]] || { echo "n01: no guests registered" >&2; exit 1; }

cat > "$OUT" <<HTML
<!doctype html><meta charset="utf-8"><title>N-01 passes</title>
<style>body{font:16px system-ui;margin:16px;background:#fff}div{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:24px}
figure{margin:0;text-align:center}img{width:200px;height:200px}figcaption{font-family:ui-monospace,monospace}</style>
<h1>N-01 — scan 1 → $n in a row, camera left on</h1><div>$cells</div>
HTML
echo "  sheet: $OUT ($n passes)"
command -v open >/dev/null && open "$OUT"
echo "  Now scan them from the iPhone booth, then the Android booth (see the header of $0)."
