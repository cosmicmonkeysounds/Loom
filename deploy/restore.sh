#!/usr/bin/env bash
# Restore a backup pair (deploy/backup.sh) into a compose project.
#
#   deploy/restore.sh --project loom-drill --db <loom-db-…sql.gz> --state <loom-state-…tgz> [--check] [--yes]
#   deploy/restore.sh --latest show --project loom-drill --check --yes   # newest pair in ~/loom-backups
#   deploy/restore.sh --project loom --live --db … --state … --yes       # the warm standby / a dead host
#
# The project name keeps it apart from the live stack: `loom-drill` gets its
# own volumes and starts only `db` + `loom` (no Caddy, so no port clash), on
# the image .env's LOOM_TAG names — nothing is built. Restoring INTO the
# live project (`loom`, the checkout's own name) wipes it, so it needs
# --live: that is only for the standby or a rebuilt host.
#
# --check proves the drill's acceptance: for every event whose state has a
# guests.json, the first guest token still reads its own view
# (GET /e/<id>/api/state?role=guest with that token → 200 + their id).
#
# Tear a drill down with: docker compose -p loom-drill down -v
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

live_project() { echo "${COMPOSE_PROJECT_NAME:-$(env_get COMPOSE_PROJECT_NAME)}" | grep . || basename "$LOOM_DIR"; }

# newest_pair LABEL — "<db> <state>" of the newest backup with that label.
newest_pair() {
  local sha
  sha="$(ls -1t "$LOOM_BACKUP_DIR"/loom-"$1"-*.sha256 2>/dev/null | head -n1)"
  [ -n "$sha" ] || return 1
  local ts="${sha##*/loom-$1-}"; ts="${ts%.sha256}"
  echo "$LOOM_BACKUP_DIR/loom-db-$1-$ts.sql.gz $LOOM_BACKUP_DIR/loom-state-$1-$ts.tgz"
}

# The --check probe, run by node inside the restored loom container.
CHECK_JS='
const fs = require("fs"), path = require("path");
const roots = [["default", "/data"]];
for (const d of fs.readdirSync("/data", { withFileTypes: true }))
  if (d.isDirectory() && fs.existsSync(path.join("/data", d.name, "guests.json"))) roots.push([d.name, path.join("/data", d.name)]);
(async () => {
  let ok = 0, bad = 0;
  for (const [id, dir] of roots) {
    let entries;
    try { entries = JSON.parse(fs.readFileSync(path.join(dir, "guests.json"), "utf8")); } catch { continue; }
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const [token, gid] = entries[0];
    const r = await fetch(`http://127.0.0.1:7000/e/${id}/api/state?role=guest`, { headers: { "x-loom-token": token } });
    const body = await r.text();
    if (r.status === 404) { console.log(`  - ${id}: not running after restore (ended event?) — skipped`); continue; }
    if (r.ok && body.includes(gid)) { ok++; console.log(`  ✔ ${id}: guest ${gid} still reads their view with the old token (${entries.length} tokens)`); }
    else { bad++; console.log(`  ✘ ${id}: ${r.status} for guest ${gid}: ${body.slice(0, 120)}`); }
  }
  if (ok === 0 && bad === 0) console.log("  ✘ no guest tokens in the restored state — restore a backup taken after someone registered");
  process.exit(ok > 0 && bad === 0 ? 0 : 1);
})().catch((e) => { console.log("  ✘ " + e); process.exit(1); });
'

check() { compose -p "$1" exec -T loom node -e "$CHECK_JS"; }

main() {
  local project="" db="" st="" yes=0 live=0 docheck=0 latest=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --project|-p) project="${2:?}"; shift ;;
      --db) db="${2:?}"; shift ;;
      --state) st="${2:?}"; shift ;;
      --latest) latest="${2:?}"; shift ;;
      --check) docheck=1 ;;
      --check-only) docheck=2 ;;
      --live) live=1 ;;
      --yes|-y) yes=1 ;;
      -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; return ;;
      *) die "unknown argument $1" ;;
    esac
    shift
  done
  [ -n "$project" ] || die "--project is required (e.g. loom-drill)"
  if [ "$docheck" = 2 ]; then check "$project"; return; fi
  if [ -n "$latest" ]; then
    local pair; pair="$(newest_pair "$latest")" || die "no '$latest' backup in $LOOM_BACKUP_DIR"
    db="${pair% *}"; st="${pair#* }"
  fi
  [ -f "$db" ] || die "--db file not found: ${db:-(none)}"
  [ -f "$st" ] || die "--state file not found: ${st:-(none)}"
  if [ "$project" = "$(live_project)" ] && [ "$live" != 1 ]; then
    die "'$project' is the live stack — restoring wipes it. Use a drill project (loom-drill), or --live on the standby."
  fi

  # Integrity first: the sha file next to the pair, then gzip.
  local sha="${db%.sql.gz}.sha256"; sha="${sha/loom-db-/loom-}"
  if [ -f "$sha" ]; then (cd "$(dirname "$sha")" && sha256_check "$(basename "$sha")") || die "checksum mismatch ($sha)"; fi
  gzip -t "$db" && gzip -t "$st" || die "a backup file is not valid gzip"

  say "restore into project '$project' on image tag $(current_tag):"
  say "  db    $db"
  say "  state $st"
  if [ "$yes" != 1 ]; then
    read -r -p "This WIPES project '$project' (db + state). Type the project name to go on: " ans
    [ "$ans" = "$project" ] || die "cancelled"
  fi

  compose -p "$project" stop loom >/dev/null 2>&1 || true
  compose -p "$project" up -d db
  local t=0
  until compose -p "$project" exec -T db pg_isready -U loom -d loom >/dev/null 2>&1; do
    t=$((t + 1)); [ "$t" -lt 60 ] || die "db never became ready"; sleep 1
  done
  gzip -dc "$db" | compose -p "$project" exec -T db psql -q -U loom -d loom -v ON_ERROR_STOP=1 >/dev/null \
    || die "psql restore failed"
  say "db restored"

  # Replace the state volume's contents through the (stopped) loom service.
  compose -p "$project" run --rm --no-deps -T --entrypoint sh loom \
    -c 'find /data -mindepth 1 -delete && tar xzf - -C /data' < "$st" || die "state restore failed"
  say "state restored"

  compose -p "$project" up -d --no-build db loom
  wait_healthy "$project" "${LOOM_HEALTH_SECS:-180}" || die "loom did not come up healthy — docker compose -p $project logs loom"
  say "project '$project' is up ✔"
  if [ "$docheck" = 1 ]; then
    check "$project" || die "old guest tokens do NOT read their views"
    say "drill check passed ✔"
  fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
