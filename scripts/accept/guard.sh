# Sourced by the bash acceptance helpers that write to an event. Strips the
# guard's own flags off the caller's arguments and gives it `guard_writes`:
#
#   source "$(dirname "$0")/guard.sh" "$@"; set -- ${ARGS[@]+"${ARGS[@]}"}
#   …resolve $event + $token…
#   guard_writes "fire call_to_the_desktop"     # exits 3 on a live-looking event or a "no"
#
# `--yes` skips the y/N; `--i-know-this-is-live` overrides the real-guest refusal.
GUARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD_FLAGS=()
ARGS=()
for a in "$@"; do
  case "$a" in
    --yes|--i-know-this-is-live) GUARD_FLAGS+=("$a") ;;
    *) ARGS+=("$a") ;;
  esac
done
guard_writes() {
  node --no-warnings "$GUARD_DIR/guard-cli.ts" --base "$BASE" --event "$event" --token "$token" --action "$1" ${GUARD_FLAGS[@]+"${GUARD_FLAGS[@]}"} || exit 3
}
