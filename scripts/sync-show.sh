#!/usr/bin/env bash
# Push the show's story to the VPS and restart its event on the new text.
#
#   LOOM_SSH=root@app.mapsandducks.com scripts/sync-show.sh
#   LOOM_SSH=deploy@1.2.3.4 LOOM_PROJECT="Trapped" scripts/sync-show.sh --no-reload
#   scripts/sync-show.sh --dry-run          # print what it would do, touch nothing
#
# What it does: opens an SSH tunnel to the VPS's Postgres container (not
# published on any host port — the tunnel dials its Docker-network IP from
# the VPS side), then runs `core/scripts/sync-example.ts` with DATABASE_URL
# on the tunnel and `--server` on the public origin. sync-example writes the
# example's files into the project, updates the running event's snapshot
# and (unless --no-reload) reloads it over the mod API — a real cut: every
# guest re-joins. Never run it after doors (OCT31.md §3).
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
# Extra arguments (e.g. --no-reload) are passed through to sync-example.
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
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) PASS+=("$a") ;;
  esac
done

if [[ -z "${LOOM_SSH:-}" ]]; then
  echo "sync-show: set LOOM_SSH to the VPS ssh destination, e.g. LOOM_SSH=root@app.mapsandducks.com" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $DRY -eq 1 ]]; then
  echo "would: ssh $LOOM_SSH  →  docker IP of the 'db' service in $LOOM_VPS_DIR (+ POSTGRES_PASSWORD from its .env if unset)"
  echo "would: ssh -N -L 127.0.0.1:$LOOM_TUNNEL_PORT:<db ip>:5432 $LOOM_SSH"
  echo "would: DATABASE_URL=postgres://loom:***@127.0.0.1:$LOOM_TUNNEL_PORT/loom \\"
  echo "         pnpm --filter @loom/core exec tsx scripts/sync-example.ts \"$LOOM_PROJECT\" $LOOM_EXAMPLE --server $LOOM_SERVER ${PASS[*]:-}"
  exit 0
fi

# 1. Where the db container lives on the VPS's Docker network.
DB_IP="$(ssh "$LOOM_SSH" "cd $LOOM_VPS_DIR && docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' \$(docker compose ps -q db)" | awk '{print $1}')"
if [[ -z "$DB_IP" ]]; then
  echo "sync-show: no running 'db' service in $LOOM_VPS_DIR on $LOOM_SSH" >&2
  exit 1
fi

# 2. The db password: local env wins, else the VPS's .env.
if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  POSTGRES_PASSWORD="$(ssh "$LOOM_SSH" "cd $LOOM_VPS_DIR && sed -n 's/^POSTGRES_PASSWORD=//p' .env | tail -1")"
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
cd "$ROOT"
DATABASE_URL="postgres://loom:$PW_ENC@127.0.0.1:$LOOM_TUNNEL_PORT/loom" \
  pnpm --filter @loom/core exec tsx scripts/sync-example.ts \
  "$LOOM_PROJECT" "$LOOM_EXAMPLE" --server "$LOOM_SERVER" ${PASS[@]+"${PASS[@]}"}
