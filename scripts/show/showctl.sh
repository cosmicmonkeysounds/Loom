#!/usr/bin/env bash
# showctl on macOS / Linux — show-night diagnostics (see README.md here).
#   scripts/show/showctl.sh doctor --watch 15
#   LOOM_MOD_CODE=… scripts/show/showctl.sh preflight macbook
# Needs Node ≥ 22.6 (it runs the TypeScript straight, no install step).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "showctl: node not found — install Node 22.6 or newer" >&2; exit 2; }
exec node --experimental-strip-types --no-warnings "$HERE/showctl.ts" "$@"
