#!/usr/bin/env bash
# Back up the two things that matter, on the VPS (or the standby):
#   loom-db-<label>-<UTC stamp>.sql.gz     pg_dump of accounts/projects/events
#   loom-state-<label>-<UTC stamp>.tgz     the /data volume (journals,
#                                          guests.json tokens, codes, sessions,
#                                          spatial-house.json, pictures/)
# plus a .sha256 for the pair, in ~/loom-backups (LOOM_BACKUP_DIR).
#
#   deploy/backup.sh [--label nightly|show|pre-release|…] [--keep-days 14]
#
# `--label show` (the 10-min show-night copy) leaves pictures/ out: it is a
# re-fetchable image cache and would make 48 copies a night heavy.
# The last stdout line is machine-readable for the off-box puller:
#   BACKUP <db file> <state file> <sha file>
#
# Nightly cron, on the VPS's clock — which must be UTC (`timedatectl`
# shows "Time zone: Etc/UTC"; Ubuntu's cron ignores CRON_TZ), so the
# DST change at 02:00 Nov 1 can't move it:
#   17 9 * * * cd ~/loom && deploy/backup.sh --label nightly >> ~/loom-backups/backup.log 2>&1
set -euo pipefail
umask 077   # guest tokens, the mod session store and the DB dump: owner-only
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

main() {
  local label=manual keep="${LOOM_BACKUP_KEEP_DAYS:-14}"
  while [ $# -gt 0 ]; do
    case "$1" in
      --label) label="${2:?}"; shift ;;
      --keep-days) keep="${2:?}"; shift ;;
      -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; return ;;
      *) die "unknown argument $1" ;;
    esac
    shift
  done
  [[ "$label" =~ ^[a-z0-9-]+$ ]] || die "bad label '$label'"
  mkdir -p "$LOOM_BACKUP_DIR"
  local ts db st sha excl=()
  ts="$(stamp)"
  db="loom-db-$label-$ts.sql.gz"
  st="loom-state-$label-$ts.tgz"
  sha="loom-$label-$ts.sha256"
  [ "$label" = show ] && excl=(--exclude=./pictures)

  cd "$LOOM_BACKUP_DIR"
  # Write to .part names and rename, so the puller never copies a half file.
  compose exec -T db pg_dump -U loom -d loom --clean --if-exists --no-owner \
    | gzip -c > "$db.part" || die "pg_dump failed — is the db service up?"
  gzip -t "$db.part" || die "pg_dump output is not valid gzip"
  (set +o pipefail; gzip -dc "$db.part" | head -n 20 | grep -q 'PostgreSQL database dump') \
    || die "pg_dump wrote no dump header — is the db service up?"

  # tar exits 1 for "file changed as we read it" (a journal append mid-copy;
  # a torn final line is tolerated on replay) — fine. 2+ is a real failure.
  local rc=0
  compose exec -T loom tar czf - -C /data ${excl[@]+"${excl[@]}"} . > "$st.part" || rc=$?
  [ "$rc" -le 1 ] || die "state tar failed (exit $rc)"
  gzip -t "$st.part" || die "state tar is not valid gzip"

  mv "$db.part" "$db"; mv "$st.part" "$st"
  sha256_of "$db" "$st" > "$sha"

  find "$LOOM_BACKUP_DIR" -maxdepth 1 -name 'loom-*' -type f -mtime +"$keep" -delete 2>/dev/null || true
  say "backup $label: $(du -h "$db" | cut -f1) db, $(du -h "$st" | cut -f1) state → $LOOM_BACKUP_DIR"
  echo "BACKUP $LOOM_BACKUP_DIR/$db $LOOM_BACKUP_DIR/$st $LOOM_BACKUP_DIR/$sha"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
