#!/usr/bin/env bash
# Print the show-day pre-show checklist (OCT31 §11) as tick boxes, ready to
# print for the director:  scripts/ops/checklist.sh | lpr
#
#   scripts/ops/checklist.sh --probe [URL]   # + the VPS's /api/health now
#
# --probe (default URL: $LOOM_SERVER, else https://app.mapsandducks.com)
# heads the sheet with what the public /api/health answers at print time:
# 200 {"ok":true,"controlPlane":true,"events":N} = the server is up, its
# control plane is on and every live event is back; anything else is
# printed as a ⚠ line to deal with before doors.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLAN="$ROOT/core/examples/trapped-in-the-internet/OCT31.md"
probe=""
while [ $# -gt 0 ]; do
  case "$1" in
    --probe) probe="${LOOM_SERVER:-https://app.mapsandducks.com}"
             if [ -n "${2:-}" ] && [ "${2#-}" = "$2" ]; then probe="$2"; shift; fi ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument $1" >&2; exit 64 ;;
  esac
  shift
done
echo "TRAPPED IN THE INTERNET — pre-show checklist ($(date +%F))"
if [ -n "$probe" ]; then
  out="$(mktemp)"; trap 'rm -f "$out"' EXIT
  code="$(curl -sS -o "$out" -w '%{http_code}' --max-time 10 "${probe%/}/api/health" 2>/dev/null || true)"
  body="$(head -c 200 "$out" 2>/dev/null | tr -d '\n')"; [ "$code" = 000 ] && code=""
  if [ "$code" = 200 ]; then echo "VPS health $(date +%H:%M): ✔ $body"
  else echo "VPS health $(date +%H:%M): ⚠ ${probe%/}/api/health answered ${code:-nothing} ${body} — fix before doors"; fi
fi
echo
awk '/^\*\*Pre-show checklist\*\*/ { on=1; next }
     on && /^\*\*/ { exit }
     on && /^[0-9]+\. / { sub(/^[0-9]+\. /, "[ ] "); gsub(/\*+/, ""); gsub(/`/, ""); print; print "" }' "$PLAN"
echo "Signed: ____________________   Time: ________"
