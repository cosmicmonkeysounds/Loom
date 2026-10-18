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
#   CURL             the curl binary (likewise)

LOOM_DIR="${LOOM_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LOOM_OPS_HOME="${LOOM_OPS_HOME:-$HOME/loom-ops}"
LOOM_BACKUP_DIR="${LOOM_BACKUP_DIR:-$HOME/loom-backups}"
DOCKER="${DOCKER:-docker}"
CURL="${CURL:-curl}"
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

# env_warn [file] — warn (never fail) about the show night's .env knobs:
# the door-rush throttles below the night's values (blank = the defaults,
# e.g. 10 failed codes / 5 min per IP — and the whole house Wi-Fi is ONE
# IP), a blank Web Push pair (push off, no 🔔 card), a join base that is
# not https:// (QRs on the request origin). Returns 1 after any warning.
# The night's values: docs/loom-docker-deploy.md §3 *Show settings*.
env_warn() {
  local f="${1:-$LOOM_DIR/.env}" n=0 k want v max url
  for k in LOOM_RL_RESOLVE=600 LOOM_RL_REGISTER=400 LOOM_RL_LOGIN_FAILURES=100/300; do
    want="${k#*=}"; k="${k%%=*}"
    v="$(env_get "$k" "$f" | tr -d "\"' ")"; max="${v%%/*}"
    if ! [[ "$max" =~ ^[0-9]+$ ]] || [ "$max" -lt "${want%%/*}" ]; then
      say "WARNING: $k=${v:-(blank: the default)} — the night wants $k=$want"; n=$((n + 1))
    fi
  done
  for k in LOOM_VAPID_PUBLIC_KEY LOOM_VAPID_PRIVATE_KEY; do
    [ -n "$(env_get "$k" "$f" | tr -d "\"' ")" ] || { say "WARNING: $k is blank — Web Push is off (no 🔔 card)"; n=$((n + 1)); }
  done
  url="$(env_get LOOM_BASE_URL "$f" | tr -d "\"'")"
  case "$url" in
    https://*) ;;
    *) say "WARNING: LOOM_BASE_URL=${url:-(blank)} — the join QRs want the public https:// origin"; n=$((n + 1)) ;;
  esac
  [ "$n" = 0 ]
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
# server image still exists. So two rollbacks in a row toggle back. Lines
# whose kind ends in -unhealthy are skipped: a release that failed its
# health check is never a rollback target.
previous_tag() {
  [ -f "$RELEASES" ] || return 0
  local t
  # tail -r is BSD, tac is GNU; awk reverses portably.
  while read -r t; do
    [ "$t" = "$1" ] && continue
    image_exists "$SERVER_IMAGE:$t" && { echo "$t"; return 0; }
  done < <(awk '$3 !~ /-unhealthy$/ { l[++n]=$2 } END { for (i=n; i>0; i--) print l[i] }' "$RELEASES")
}

# releases_logged — true once anything (release / adopt / rollback) is logged.
releases_logged() { [ -s "$RELEASES" ]; }

sha256_of() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
sha256_check() { if command -v sha256sum >/dev/null; then sha256sum -c --quiet "$@"; else shasum -a 256 -c --quiet "$@"; fi; }

# wait_healthy [project] [seconds] — until the loom container's compose
# healthcheck (docker-compose.yml: /api/health) reports healthy.
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

# http_code URL — the HTTP status URL answers (000 = no answer at all).
http_code() { "$CURL" -sS -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || true; }

# public_ok [--old-ok] — the public origin's /api/health answers 200, i.e.
# the server is up AND (with a database) its control plane + every live
# event are back (two tries; skipped without curl or a URL). --old-ok is
# for a rollback, which may boot an image older than the route: a 404
# there is then accepted when the play shell at / answers.
public_ok() {
  local old=0 url code="" try
  [ "${1:-}" = --old-ok ] && old=1
  url="$(env_get LOOM_BASE_URL)"; url="${url%/}"
  [ -n "$url" ] && command -v "$CURL" >/dev/null || return 0
  for try in 1 2; do
    code="$(http_code "$url/api/health")"
    [ "$code" = 200 ] && return 0
    if [ "$code" = 404 ] && [ "$old" = 1 ] && [ "$(http_code "$url/")" = 200 ]; then
      say "$url has no /api/health (an older image) — its play shell answers"
      return 0
    fi
    [ "$try" = 2 ] || sleep "${LOOM_POLL:-3}"
  done
  say "$url/api/health answered ${code:-nothing}"
  return 1
}

# health_body [project] — what loom's /api/health says from inside its
# container ({"ok":false,"reason":"database"} …), for a failure message.
health_body() {
  local p=()
  [ -n "${1:-}" ] && p=(-p "$1")
  compose ${p[@]+"${p[@]}"} exec -T loom node -e \
    "fetch('http://127.0.0.1:7000/api/health').then(async r=>console.log(r.status+' '+(await r.text()).slice(0,200))).catch(e=>console.log('no answer: '+e.message))" 2>/dev/null || true
}
