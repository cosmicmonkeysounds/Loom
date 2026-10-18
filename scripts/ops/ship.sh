#!/usr/bin/env bash
# Ship the stamped commit to the VPS as a pinned release, from your Mac.
#
#   scripts/ops/ship.sh show-1031 [--force] [--dry-run]
#   scripts/ops/ship.sh --sync-only [--force] [--dry-run]
#
# 1. refuses unless scripts/ops/predeploy.sh passed for HEAD (--force skips),
# 2. rsyncs the tree to the VPS — never anything git-ignored (secrets.h,
#    reinstall/vr/build/ with its station.json passcodes, *.local.yaml, .env …),
# 3. runs deploy/release.sh <tag> --commit <sha> there over ssh
#    (first release: adopt what runs as pre-<tag> → pre-release backup →
#    build → up → health → release log). --sync-only stops after step 2.
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

tag="" force=0 dry=0 sync_only=0
for a in "$@"; do
  case "$a" in
    --force) force=1 ;;
    --sync-only) sync_only=1 ;;
    --dry-run) dry=1 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown flag $a" >&2; exit 64 ;;
    *) tag="$a" ;;
  esac
done
[ -n "$tag" ] || [ "$sync_only" = 1 ] || { echo "usage: scripts/ops/ship.sh <tag>|--sync-only [--force] [--dry-run]" >&2; exit 64; }

cd "$ROOT"
HEAD="$(git rev-parse HEAD)"
STAMP="${LOOM_PREDEPLOY_STAMP:-$(git rev-parse --git-dir)/loom-predeploy-ok}"
if [ "$force" != 1 ]; then
  [ "$(cat "$STAMP" 2>/dev/null)" = "$HEAD" ] \
    || { echo "✘ pre-deploy has not passed for $(git rev-parse --short HEAD) — run scripts/ops/predeploy.sh (or --force)" >&2; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "✘ the tree changed since the pre-deploy run" >&2; exit 1; }
fi

do_() { if [ "$dry" = 1 ]; then echo "[dry-run] $*"; else "$@"; fi; }

# Never anything git-ignored: every .gitignore is merged in as an exclude
# list (`:- .gitignore`), plus explicit belts for the known secrets. Excluded
# files are also protected from --delete, so the VPS's own .env and state
# stay put. (The pre-deploy stamp needs a clean tree, so what is left is
# exactly what git tracks.)
# The VPS checkout is also the operator's working directory, so the `P`
# (protect) rules keep what an operator leaves at its top from --delete
# without stopping a tracked file of that name from shipping (.env.example
# still goes): dated .env backups, the ./show-map bind mount, a compose
# override, hand-made dumps (`loom-db-*.sql`, `loom-state-*.tgz`), *.bak.
# The repo's own ignore list (.git/info/exclude — shared by every worktree)
# is never read by `:- .gitignore`; it is where the agent worktrees under
# .claude/worktrees/ are ignored (GBs of other checkouts), so it is merged in
# too, and .claude/worktrees/ is belted explicitly.
info_exclude="$(git rev-parse --git-common-dir)/info/exclude"
xfrom=(); [ -r "$info_exclude" ] && xfrom=(--exclude-from="$info_exclude")
echo "── shipping $(git rev-parse --short HEAD)${tag:+ as $tag} → $LOOM_VPS:~/$LOOM_VPS_DIR"
do_ "$RSYNC" -az --delete --filter=':- .gitignore' ${xfrom[@]+"${xfrom[@]}"} \
  --filter='P /.env*' --filter='P /show-map/' \
  --filter='P /docker-compose.override.yml' --filter='P /docker-compose.override.yaml' \
  --filter='P /loom-db-*' --filter='P /loom-state-*' --filter='P /*.sql*' --filter='P /*.tgz' \
  --filter='P /*.bak*' \
  --exclude .git --exclude node_modules --exclude dist --exclude target \
  --exclude .env --exclude .loom-state --exclude .venv \
  --exclude '*.local.yaml' --exclude secrets.h --exclude reinstall/vr/build \
  --exclude '*.keystore' --exclude /.claude/worktrees/ \
  "$ROOT/" "$LOOM_VPS:$LOOM_VPS_DIR/"
# The rsync skips .git, so the VPS checkout's git record would stay on the
# commit it was cloned at while its files moved on: every shipped file then
# reads as a local change and a `git pull` there refuses ("would be
# overwritten by merge"). Point the record at the shipped commit — a mixed
# reset moves HEAD + the index only, never a file — so `git status` on the
# VPS is clean after a ship. Needs the commit on origin (push first).
if [ -n "$(git branch -r --contains "$HEAD" 2>/dev/null)" ]; then
  do_ "$SSH" "$LOOM_VPS" "cd $LOOM_VPS_DIR && if [ -d .git ]; then git fetch -q origin && git reset -q $HEAD && echo '── VPS git record → $(git rev-parse --short HEAD)'; fi"
else
  echo "⚠ $(git rev-parse --short HEAD) is not pushed: the VPS's git record stays where it was (push, then re-run with --sync-only)" >&2
fi
if [ "$sync_only" = 1 ]; then
  echo "── synced only. Release with: scripts/ops/ship.sh <tag>"
  exit 0
fi
do_ "$SSH" "$LOOM_VPS" "cd $LOOM_VPS_DIR && deploy/release.sh $tag --commit $HEAD"
