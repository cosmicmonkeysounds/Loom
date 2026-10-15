#!/usr/bin/env bash
# Build + deploy a PINNED release on the VPS, keeping the previous image for
# a one-command rollback (deploy/rollback.sh). Run in the checkout:
#
#   deploy/release.sh show-1031 [--commit <sha>] [--no-backup]
#   deploy/release.sh --adopt pre-k08      # tag what runs now; no rebuild
#   deploy/release.sh --list               # the release log + local images
#
# A release: (1) a pre-release backup (deploy/backup.sh --label pre-release),
# (2) `docker compose build` with LOOM_TAG=<tag> → images loom-server:<tag> +
# loom-proxy:<tag>, (3) LOOM_TAG=<tag> written into .env so a later plain
# `docker compose up -d` (or a reboot) stays on it, (4) `up -d`, (5) wait for
# the healthcheck + the public URL, (6) a line in ~/loom-ops/releases.log.
# A tag is never rebuilt in place — that would destroy the pinned image —
# so every deploy takes a new tag (show-1031, show-1031b, …).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

list() {
  echo "running: $(current_tag)"
  echo "-- $RELEASES"
  [ -f "$RELEASES" ] && tail -n 20 "$RELEASES" || echo "(no releases yet)"
  echo "-- images"
  "$DOCKER" image ls --format '{{.Repository}}:{{.Tag}}  {{.CreatedSince}}  {{.Size}}' \
    | grep -E "^($SERVER_IMAGE|$PROXY_IMAGE):" || true
}

adopt() { # tag the images the running containers use, so there is a rollback target
  local tag="$1" svc img id
  for svc in loom caddy; do
    img="$SERVER_IMAGE"; [ "$svc" = caddy ] && img="$PROXY_IMAGE"
    id="$(compose ps -q "$svc" | head -n1)"
    [ -n "$id" ] || die "service $svc is not running — nothing to adopt"
    "$DOCKER" tag "$("$DOCKER" inspect --format '{{.Image}}' "$id")" "$img:$tag"
    say "tagged the running $svc as $img:$tag"
  done
  env_set LOOM_TAG "$tag"
  log_release "$tag" adopt "${COMMIT:-}"
  say "adopted: rollback target $tag is in place (.env LOOM_TAG=$tag)"
}

main() {
  local tag="" backup=1 mode=release
  COMMIT=""
  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) usage ;;
      --list) mode=list ;;
      --adopt) mode=adopt; tag="${2:-}"; shift ;;
      --commit) COMMIT="${2:-}"; shift ;;
      --no-backup) backup=0 ;;
      -*) usage 1 ;;
      *) tag="$1" ;;
    esac
    shift
  done
  [ "$mode" = list ] && { list; return; }
  [ -n "$tag" ] || usage 1
  [[ "$tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || die "bad tag '$tag' (letters, digits, . _ -)"
  [ -f "$LOOM_DIR/.env" ] || die "no .env in $LOOM_DIR"
  [ "$mode" = adopt ] && { adopt "$tag"; return; }

  local prev; prev="$(current_tag)"
  [ "$tag" = "$prev" ] && die "$tag is already running — take a new tag (e.g. ${tag}b)"
  image_exists "$SERVER_IMAGE:$tag" && die "$SERVER_IMAGE:$tag already exists — never rebuild a pinned tag; take a new one"

  if [ "$backup" = 1 ]; then
    "$(dirname "${BASH_SOURCE[0]}")/backup.sh" --label pre-release || die "pre-release backup failed (use --no-backup to skip)"
  fi

  say "building $tag (previous: $prev) …"
  ( export LOOM_TAG="$tag"; compose build )
  env_set LOOM_TAG "$tag"
  compose up -d
  if wait_healthy "" "${LOOM_HEALTH_SECS:-180}" && public_ok; then
    log_release "$tag" release "$COMMIT"
    say "released $tag ✔  (rollback: deploy/rollback.sh → $prev)"
  else
    say "$tag is NOT healthy. Look: docker compose logs --tail 80 loom"
    say "roll back now with: deploy/rollback.sh $prev"
    log_release "$tag" release-unhealthy "$COMMIT"
    exit 2
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
