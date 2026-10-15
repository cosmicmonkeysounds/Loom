# Shared helpers for the VPS ops scripts (release / rollback / backup /
# restore). Sourced, never run. Plain bash + coreutils so it works on the
# Ubuntu VPS, the warm standby and (for the tests) macOS.
#
# Knobs (environment):
#   LOOM_DIR         the repo checkout holding docker-compose.yml + .env
#                    (default: the directory above this file)
#   LOOM_OPS_HOME    where the release log lives (default ~/loom-ops) — kept
#                    OUTSIDE the checkout so `rsync --delete` never eats it
#   LOOM_BACKUP_DIR  where backups land (default ~/loom-backups)
#   DOCKER           the docker binary (tests point it at a fake)

LOOM_DIR="${LOOM_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOOM_OPS_HOME="${LOOM_OPS_HOME:-$HOME/loom-ops}"
LOOM_BACKUP_DIR="${LOOM_BACKUP_DIR:-$HOME/loom-backups}"
DOCKER="${DOCKER:-docker}"
RELEASES="$LOOM_OPS_HOME/releases.log"
# The images every release is tagged under (docker-compose.yml `image:`).
SERVER_IMAGE="loom-server"
PROXY_IMAGE="loom-proxy"

say()  { printf '%s\n' "loom-ops: $*" >&2; }
die()  { say "ERROR: $*"; exit 1; }
utc()  { date -u +%Y-%m-%dT%H:%M:%SZ; }
stamp() { date -u +%Y%m%dT%H%M%SZ; }

# compose [-p project] … — always run against the checkout's compose file.
compose() { ( cd "$LOOM_DIR" && "$DOCKER" compose "$@" ); }

# env_get KEY [file] — the value of KEY in .env (last one wins), or empty.
env_get() {
  local f="${2:-$LOOM_DIR/.env}"
  [ -f "$f" ] || return 0
  awk -v k="$1" -F= '$1==k { sub(/^[^=]*=/, ""); v=$0 } END { if (v!="") print v }' "$f"
}

# env_set KEY VALUE [file] — replace KEY's line in .env, or append it.
# Every other line (comments, secrets) is kept byte for byte.
env_set() {
  local k="$1" v="$2" f="${3:-$LOOM_DIR/.env}" tmp
  [ -f "$f" ] || : > "$f"
  tmp="$(mktemp "$f.XXXXXX")"
  awk -v k="$k" -v v="$v" -F= '
    $1==k { if (!done) print k "=" v; done=1; next }
    { print }
    END { if (!done) print k "=" v }' "$f" > "$tmp"
  cat "$tmp" > "$f" && rm -f "$tmp"
}

# The tag the stack runs now (.env LOOM_TAG, else compose's default).
current_tag() { local t; t="$(env_get LOOM_TAG)"; echo "${t:-latest}"; }

image_exists() { "$DOCKER" image inspect "$1" >/dev/null 2>&1; }

# log_release TAG KIND [COMMIT] — append "utc tag kind commit" to the log.
log_release() {
  mkdir -p "$LOOM_OPS_HOME"
  printf '%s %s %s %s\n' "$(utc)" "$1" "$2" "${3:--}" >> "$RELEASES"
}

# previous_tag CURRENT — the newest logged tag that isn't CURRENT and whose
# server image still exists. So two rollbacks in a row toggle back.
previous_tag() {
  [ -f "$RELEASES" ] || return 0
  local t
  # tail -r is BSD, tac is GNU; awk reverses portably.
  while read -r t; do
    [ "$t" = "$1" ] && continue
    image_exists "$SERVER_IMAGE:$t" && { echo "$t"; return 0; }
  done < <(awk '{ l[NR]=$2 } END { for (i=NR; i>0; i--) print l[i] }' "$RELEASES")
}

sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
sha256_check() { if command -v sha256sum >/dev/null; then sha256sum -c --quiet "$@"; else shasum -a 256 -c --quiet "$@"; fi; }

# wait_healthy [project] [seconds] — until the loom container's compose
# healthcheck reports healthy.
wait_healthy() {
  local p=() secs="${2:-180}" t=0 id status
  [ -n "${1:-}" ] && p=(-p "$1")
  while [ "$t" -lt "$secs" ]; do
    id="$(compose ${p[@]+"${p[@]}"} ps -q loom 2>/dev/null | head -n1)"
    if [ -n "$id" ]; then
      status="$("$DOCKER" inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null)"
      [ "$status" = healthy ] && return 0
    fi
    sleep "${LOOM_POLL:-3}"; t=$((t + ${LOOM_POLL:-3}))
  done
  return 1
}

# public_ok — the public origin answers (skipped without curl or a URL).
public_ok() {
  local url; url="$(env_get LOOM_BASE_URL)"
  [ -n "$url" ] && command -v curl >/dev/null || return 0
  curl -fsS -o /dev/null --max-time 10 "$url/" || curl -fsS -o /dev/null --max-time 10 "$url/"
}
