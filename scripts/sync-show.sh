#!/usr/bin/env bash
# Push the show's story to the VPS and restart its event on the new text.
#
#   LOOM_SSH=root@app.mapsandducks.com scripts/sync-show.sh
#   LOOM_SSH=deploy@1.2.3.4 LOOM_PROJECT="Trapped" scripts/sync-show.sh --no-reload
#   scripts/sync-show.sh --dry-run          # print what it would do, touch nothing
#   scripts/sync-show.sh --i-know-this-is-live   # reload a LIVE show anyway
#
# What it does: opens an SSH tunnel to the VPS's Postgres container (not
# published on any host port — the tunnel dials its Docker-network IP from
# the VPS side), then runs `core/scripts/sync-example.ts` with DATABASE_URL
# on the tunnel and `--server` on the public origin. sync-example writes the
# example's files into the project, updates the running event's snapshot
# and (unless --no-reload) reloads it over the mod API — a real cut: every
# guest re-joins. Never run it after doors (OCT31.md §3): on a `live`
# event with a real guest on its roster it writes the files but leaves the
# event alone (snapshot untouched, no reload) and exits 3 — Push draft from
# Run instead, or pass --i-know-this-is-live. The house maps
# (house.json, house.<variant>.json) go with the story (SW-MAP-01) — deploy
# a server that knows them first: an older one would read them as story
# text on its next launch. The project's maps win: a map surveyed on the
# map page and kept with "Save to project" is never overwritten (it is
# summarised next to the repo's copy); --replace-maps overwrites them with
# the repo's, --keep-maps touches none.
#
# Environment (all optional except LOOM_SSH):
#   LOOM_SSH           ssh destination of the VPS (user@host) — required
#   LOOM_VPS_DIR       compose directory on the VPS (holds docker-compose.yml
#                      + .env), relative to the ssh home   default: loom
#   LOOM_PROJECT       project name or id              default: Untitled Project
#   LOOM_EXAMPLE       core/examples/<name>            default: trapped-in-the-internet
#   LOOM_SERVER        public origin for the mod API   default: https://app.mapsandducks.com
#   LOOM_TUNNEL_PORT   local end of the tunnel         default: 15432
#   POSTGRES_PASSWORD  the VPS db password; read from the VPS's .env if unset
#
# Extra arguments (e.g. --no-reload, --i-know-this-is-live) are passed
# through to sync-example; its exit code is this script's (3 = a live
# event was left alone).
set -euo pipefail

: "${LOOM_VPS_DIR:=loom}"
: "${LOOM_PROJECT:=Untitled Project}"
: "${LOOM_EXAMPLE:=trapped-in-the-internet}"
: "${LOOM_SERVER:=https://app.mapsandducks.com}"
: "${LOOM_TUNNEL_PORT:=15432}"

DRY=0
PASS=()
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    -h|--help) awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"; exit 0 ;;
    *) PASS+=("$a") ;;
  esac
done

if [[ -z "${LOOM_SSH:-}" ]]; then
  echo "sync-show: set LOOM_SSH to the VPS ssh destination, e.g. LOOM_SSH=root@app.mapsandducks.com" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# tsx straight from core (not `pnpm exec`, which turns every exit code into 1).
TSX="${TSX:-$ROOT/core/node_modules/.bin/tsx}"
# Shell-quoted for the remote command line (a dir with spaces or quotes).
VPS_DIR_Q="$(printf '%q' "$LOOM_VPS_DIR")"

if [[ $DRY -eq 1 ]]; then
  echo "would: ssh $LOOM_SSH  →  docker IP of the 'db' service in $LOOM_VPS_DIR (+ POSTGRES_PASSWORD from its .env if unset)"
  echo "would: ssh -N -L 127.0.0.1:$LOOM_TUNNEL_PORT:<db ip>:5432 $LOOM_SSH"
  echo "would: DATABASE_URL=postgres://loom:***@127.0.0.1:$LOOM_TUNNEL_PORT/loom \\"
  echo "         (cd core && tsx scripts/sync-example.ts \"$LOOM_PROJECT\" $LOOM_EXAMPLE --server $LOOM_SERVER ${PASS[*]:-})"
  exit 0
fi

# 1. Where the db container lives on the VPS's Docker network.
DB_IP="$(ssh "$LOOM_SSH" "cd $VPS_DIR_Q && docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \$(docker compose ps -q db)" | awk '{print $1}')"
if [[ -z "$DB_IP" ]]; then
  echo "sync-show: no running 'db' service in $LOOM_VPS_DIR on $LOOM_SSH" >&2
  exit 1
fi

# 2. The db password: local env wins, else the VPS's .env.
if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  POSTGRES_PASSWORD="$(ssh "$LOOM_SSH" "cd $VPS_DIR_Q && sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -1")"
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD%\"}"; POSTGRES_PASSWORD="${POSTGRES_PASSWORD#\"}"
fi
if [[ -z "$POSTGRES_PASSWORD" ]]; then
  echo "sync-show: POSTGRES_PASSWORD not set and not found in $LOOM_VPS_DIR/.env" >&2
  exit 1
fi
PW_ENC="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$POSTGRES_PASSWORD")"

# 3. The tunnel, on a control socket so it always closes.
SOCK="$(mktemp -u "${TMPDIR:-/tmp}/loom-sync-show.XXXXXX")"
ssh -f -N -M -S "$SOCK" -o ExitOnForwardFailure=yes \
  -L "127.0.0.1:$LOOM_TUNNEL_PORT:$DB_IP:5432" "$LOOM_SSH"
trap 'ssh -S "$SOCK" -O exit "$LOOM_SSH" >/dev/null 2>&1 || true' EXIT
echo "✓ tunnel 127.0.0.1:$LOOM_TUNNEL_PORT → $LOOM_SSH → db ($DB_IP:5432)"

# 4. The sync itself.
cd "$ROOT/core"
rc=0
DATABASE_URL="postgres://loom:$PW_ENC@127.0.0.1:$LOOM_TUNNEL_PORT/loom" \
  "$TSX" scripts/sync-example.ts \
  "$LOOM_PROJECT" "$LOOM_EXAMPLE" --server "$LOOM_SERVER" ${PASS[@]+"${PASS[@]}"} || rc=$?
if [[ $rc -eq 3 ]]; then
  echo "sync-show: the event is LIVE with real guests — files written, event NOT reloaded (exit 3)" >&2
fi
exit "$rc"
