#!/usr/bin/env bash
# One-command rollback on the VPS: back to the previous release's images.
# No build, so it takes as long as a container restart (well under 5 min).
#
#   deploy/rollback.sh            # the newest logged tag that isn't running
#   deploy/rollback.sh show-1029  # a specific tag (its image must exist)
#
# Journals replay on boot and guest tokens persist in the state volume, so
# phones keep their sessions. Rolling back twice toggles back.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  case "${1:-}" in -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; return ;; esac
  local cur target t0
  cur="$(current_tag)"
  target="${1:-$(previous_tag "$cur")}"
  [ -n "$target" ] || die "no previous release to roll back to (see deploy/release.sh --list)"
  [ "$target" = "$cur" ] && die "$target is already running"
  image_exists "$SERVER_IMAGE:$target" || die "image $SERVER_IMAGE:$target is gone"
  image_exists "$PROXY_IMAGE:$target" || die "image $PROXY_IMAGE:$target is gone"

  t0=$(date +%s)
  say "rolling back $cur → $target …"
  env_set LOOM_TAG "$target"
  compose up -d --no-build
  # --old-ok: the target may predate /api/health (its play shell must answer).
  if wait_healthy "" "${LOOM_HEALTH_SECS:-180}" && public_ok --old-ok; then
    log_release "$target" rollback
    say "rolled back to $target ✔ in $(( $(date +%s) - t0 )) s"
  else
    log_release "$target" rollback-unhealthy
    die "$target is not healthy either (/api/health: $(health_body)) — docker compose logs --tail 80 loom"
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
