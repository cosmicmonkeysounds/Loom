#!/usr/bin/env bash
# Print the show-day pre-show checklist (OCT31 §11) as tick boxes, ready to
# print for the director:  scripts/ops/checklist.sh | lpr
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLAN="$ROOT/core/examples/trapped-in-the-internet/OCT31.md"
echo "TRAPPED IN THE INTERNET — pre-show checklist ($(date +%F))"
echo
awk '/^\*\*Pre-show checklist\*\*/ { on=1; next }
     on && /^\*\*/ { exit }
     on && /^[0-9]+\. / { sub(/^[0-9]+\. /, "[ ] "); gsub(/\*+/, ""); gsub(/`/, ""); print; print "" }' "$PLAN"
echo "Signed: ____________________   Time: ________"
