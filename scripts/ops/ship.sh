#!/usr/bin/env bash
# Ship the stamped commit to the VPS as a pinned release, from your Mac.
#
#   scripts/ops/ship.sh show-1031 [--force] [--dry-run]
#
# 1. refuses unless scripts/ops/predeploy.sh passed for HEAD (--force skips),
# 2. rsyncs the tree to the VPS (the docs/loom-docker-deploy.md §2 command),
# 3. runs deploy/release.sh <tag> --commit <sha> there over ssh
#    (pre-release backup → build → up → health → release log).
# Rollback from anywhere: ssh $LOOM_VPS 'cd ~/loom && deploy/rollback.sh'
#
# Config (env or ~/.config/loom/ops.env): LOOM_VPS (ssh destination,
# default ubuntu@app.mapsandducks.com), LOOM_VPS_DIR (default loom, i.e. ~/loom).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$HOME/.config/loom/ops.env" ] && . "$HOME/.config/loom/ops.env"
LOOM_VPS="${LOOM_VPS:-ubuntu@app.mapsandducks.com}"
LOOM_VPS_DIR="${LOOM_VPS_DIR:-loom}"
SSH="${SSH:-ssh}"; RSYNC="${RSYNC:-rsync}"

tag="" force=0 dry=0
for a in "$@"; do
  case "$a" in
    --force) force=1 ;;
    --dry-run) dry=1 ;;
    -h|--help) sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown flag $a" >&2; exit 64 ;;
    *) tag="$a" ;;
  esac
done
[ -n "$tag" ] || { echo "usage: scripts/ops/ship.sh <tag> [--force] [--dry-run]" >&2; exit 64; }

cd "$ROOT"
HEAD="$(git rev-parse HEAD)"
STAMP="${LOOM_PREDEPLOY_STAMP:-$(git rev-parse --git-dir)/loom-predeploy-ok}"
if [ "$force" != 1 ]; then
  [ "$(cat "$STAMP" 2>/dev/null)" = "$HEAD" ] \
    || { echo "✘ pre-deploy has not passed for $(git rev-parse --short HEAD) — run scripts/ops/predeploy.sh (or --force)" >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "✘ the tree changed since the pre-deploy run" >&2; exit 1; }
fi

do_() { if [ "$dry" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

echo "── shipping $(git rev-parse --short HEAD) as $tag → $LOOM_VPS:~/$LOOM_VPS_DIR"
do_ "$RSYNC" -az --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude target \
  --exclude .env --exclude core/server/.loom-state --exclude .venv \
  "$ROOT/" "$LOOM_VPS:$LOOM_VPS_DIR/"
do_ "$SSH" "$LOOM_VPS" "cd $LOOM_VPS_DIR && deploy/release.sh $tag --commit $HEAD"
