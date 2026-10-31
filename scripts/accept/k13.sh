#!/usr/bin/env bash
# K-13 acceptance — room check-in by QR. ~8 minutes, needs the server
# running a build that includes K-13 (`POST /e/:id/api/guest/checkin`).
#
#   1. Start a REHEARSAL in the editor (Run → Start rehearsal).
#   2. LOOM_EVENT_CODE=<guest code> scripts/accept/k13.sh
#      → opens a sheet of hand-made room-sign QRs on this Mac's screen
#        (`<server>/?code=<code>&checkin=<room>`; Run → 🖨 Print sheet
#        prints the real R01… signs).
#   3. iPhone, Safari: join the rehearsal as a guest (<server>/?code=<code>).
#      You land in the Optical Drive cutscene. Scan "The Desktop" with the iPhone's
#      own CAMERA app (not the play app) → tap the banner → Safari opens →
#      a banner says "Not yet — finish getting in first." (on rails). PASS 1.
#   4. Clear the guest: Run → Players → an Antivirus booth (e.g. Norton) →
#      Scanner → type the guest's id (their pass). Clearance walks them to
#      the Desktop and opens the house rooms for them.
#   5. Scan "The Start Bar" with the Camera app → Safari lands IN "The Start Bar"
#      chat, a "📍 Checked in" reply arrives, and Run shows the guest standing
#      in The Start Bar. PASS 2. Scan "The Desktop" within 20 s → "You just
#      checked in — try again in …s". PASS 3. Wait 20 s, scan it again →
#      lands in the Desktop room. PASS 4.
#   6. Director → capture the guest → scan "The Desktop" → "You're captured
#      — the story has to let you out first." and they do NOT move. PASS 5.
#   7. Restart the rehearsal to clear the test guest.
#
# Env: LOOM_SERVER (default https://app.mapsandducks.com).
set -uo pipefail

SERVER="${LOOM_SERVER:-https://app.mapsandducks.com}"
: "${LOOM_EVENT_CODE:?set LOOM_EVENT_CODE to the rehearsal guest code}"
OUT="${TMPDIR:-/tmp}/loom-k13-signs.html"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }

hit="$(curl -s -X POST -H 'content-type: application/json' -d '{"code":"'"$LOOM_EVENT_CODE"'"}' "$SERVER/api/resolve-code")"
ROLE="$(printf '%s' "$hit" | json role)"
[[ "$ROLE" == "guest" ]] || { echo "k13: $LOOM_EVENT_CODE is not a guest code on $SERVER: $hit" >&2; exit 1; }

# The check-in points the story's `when checked_in for program:` chain handles
# (main.loom). The server folds a slug onto the exact LOCATION name.
cells=""
for room in "The Desktop" "The Start Bar" "The CPU" "The Power Supply" "Disk Cleanup" "The Cloud" "The RAM" "The Fan Closet" "The Casino" "The Hard Drive"; do
  slug="$(printf '%s' "$room" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')"
  link="$SERVER/?code=$LOOM_EVENT_CODE&checkin=$slug"
  enc="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$link")"
  cells+="<figure><img src=\"$SERVER/api/qr?text=$enc\" alt=\"$room\"><figcaption><b>$room</b><br>Scan to enter this room's chat<br><code>$link</code></figcaption></figure>"
  echo "  $room → $link"
done

cat > "$OUT" <<HTML
<!doctype html><meta charset="utf-8"><title>K-13 room signs</title>
<style>body{font:16px system-ui;margin:16px;background:#fff}div{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:24px}
figure{margin:0;text-align:center}img{width:220px;height:220px}code{font-size:11px;word-break:break-all}</style>
<h1>K-13 — scan with the iPhone's own Camera app</h1><div>$cells</div>
HTML
echo "  sheet: $OUT"
command -v open >/dev/null && open "$OUT"
echo "  Now walk the steps in the header of $0."
