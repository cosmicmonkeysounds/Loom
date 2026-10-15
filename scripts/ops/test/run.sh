#!/usr/bin/env bash
# Tests for the K-08 ops scripts (deploy/*.sh + scripts/ops/*.sh), against a
# fake docker / ssh / scp / launchctl — nothing touches Docker or a server.
#   bash scripts/ops/test/run.sh
set -u
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HERE="$ROOT/scripts/ops/test"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); }
bad() { FAIL=$((FAIL+1)); echo "  ✘ $*"; }
check() { # output is shown only when the check fails
  local name="$1" out; shift
  if out="$("$@" 2>&1)"; then ok; else bad "$name"; echo "$out" | tail -n 8 | sed 's/^/      /'; fi; }
eq() { [ "$1" = "$2" ] || { echo "    expected [$2] got [$1]" >&2; return 1; }; }

setup() {
  T="$(mktemp -d)"
  export FAKE="$T/fake" HOME="$T/home" LOOM_DIR="$T/repo" LOOM_OPS_HOME="$T/ops" \
         LOOM_BACKUP_DIR="$T/backups" DOCKER="$HERE/fake-docker" LOOM_POLL=1 LOOM_HEALTH_SECS=2
  mkdir -p "$FAKE/images" "$FAKE/data/evt1/pictures" "$HOME" "$LOOM_DIR"
  echo '[["tok-a","g-aaaa"]]' > "$FAKE/data/guests.json"
  echo '{"m":"register"}' > "$FAKE/data/journal.ndjson"
  echo 'png' > "$FAKE/data/evt1/pictures/x.png"
  printf '# secrets\nPOSTGRES_PASSWORD=s3cret\nLOOM_BASE_URL=\n' > "$LOOM_DIR/.env"
  : > "$FAKE/calls"
}
teardown() { rm -rf "$T"; }

echo "── lib: env_get / env_set"
setup; . "$ROOT/deploy/lib.sh"
env_set LOOM_TAG one
check "env_set appends" eq "$(env_get LOOM_TAG)" one
env_set LOOM_TAG two
check "env_set replaces in place" eq "$(grep -c '^LOOM_TAG=' "$LOOM_DIR/.env")" 1
check "env_set keeps other lines" grep -q '^POSTGRES_PASSWORD=s3cret$' "$LOOM_DIR/.env"
check "env_set keeps comments" grep -q '^# secrets$' "$LOOM_DIR/.env"
check "current_tag reads .env" eq "$(current_tag)" two
check "env_get value with =" bash -c ". '$ROOT/deploy/lib.sh'; env_set K 'a=b'; [ \"\$(env_get K)\" = a=b ]"
teardown

echo "── release + rollback"
setup
check "release builds + pins" bash "$ROOT/deploy/release.sh" show-1029 --commit abc --no-backup
check "first release adopts what ran before" test -f "$FAKE/images/loom-server:pre-show-1029" -a -f "$FAKE/images/loom-proxy:pre-show-1029"
check "adopt logged before the release" bash -c "head -n1 '$LOOM_OPS_HOME/releases.log' | grep -q ' pre-show-1029 adopt'"
check "images tagged" test -f "$FAKE/images/loom-server:show-1029" -a -f "$FAKE/images/loom-proxy:show-1029"
check "build ran with LOOM_TAG" grep -q "build LOOM_TAG=show-1029" "$FAKE/calls"
check ".env pinned" grep -q '^LOOM_TAG=show-1029$' "$LOOM_DIR/.env"
check "release logged" grep -q ' show-1029 release abc$' "$LOOM_OPS_HOME/releases.log"
check "refuses the running tag" bash -c "! bash '$ROOT/deploy/release.sh' show-1029 --no-backup 2>/dev/null"
touch "$FAKE/images/loom-server:old" "$FAKE/images/loom-proxy:old"
check "refuses an existing tag" bash -c "! bash '$ROOT/deploy/release.sh' old --no-backup 2>/dev/null"
check "refuses a bad tag" bash -c "! bash '$ROOT/deploy/release.sh' 'a b' --no-backup 2>/dev/null"
check "second release" bash "$ROOT/deploy/release.sh" show-1031 --no-backup
check "release with backup" bash "$ROOT/deploy/release.sh" show-1031b
check "pre-release backup taken" bash -c "ls '$LOOM_BACKUP_DIR'/loom-db-pre-release-*.sql.gz >/dev/null"
bash "$ROOT/deploy/rollback.sh" >/dev/null 2>&1
check "rollback → previous" eq "$(LOOM_DIR=$LOOM_DIR bash -c ". '$ROOT/deploy/lib.sh'; current_tag")" show-1031
check "rollback used --no-build" grep -q "up -d --no-build" "$FAKE/calls"
check "rollback logged" grep -q ' show-1031 rollback -$' "$LOOM_OPS_HOME/releases.log"
bash "$ROOT/deploy/rollback.sh" >/dev/null 2>&1
check "second rollback toggles back" eq "$(bash -c ". '$ROOT/deploy/lib.sh'; current_tag")" show-1031b
bash "$ROOT/deploy/rollback.sh" show-1029 >/dev/null 2>&1
check "rollback to a named tag" eq "$(bash -c ". '$ROOT/deploy/lib.sh'; current_tag")" show-1029
rm "$FAKE/images/loom-server:show-1031b"
check "refuses a vanished image" bash -c "! bash '$ROOT/deploy/rollback.sh' show-1031b 2>/dev/null"
FAKE_HEALTH=starting bash "$ROOT/deploy/release.sh" bad-one --no-backup >/dev/null 2>&1; rc=$?
check "unhealthy release exits 2" eq "$rc" 2
check "unhealthy release logged" grep -q ' bad-one release-unhealthy' "$LOOM_OPS_HOME/releases.log"
check "rollback after an unhealthy release" bash "$ROOT/deploy/rollback.sh"
check "… lands on the last good tag" eq "$(bash -c ". '$ROOT/deploy/lib.sh'; current_tag")" show-1029
bash "$ROOT/deploy/rollback.sh" >/dev/null 2>&1
check "a failed release is never a rollback target" eq "$(bash -c ". '$ROOT/deploy/lib.sh'; current_tag")" show-1031
check "--list" bash -c "bash '$ROOT/deploy/release.sh' --list | grep -q 'loom-server:show-1029'"
check "--adopt tags the running images" bash "$ROOT/deploy/release.sh" --adopt pre-k08
check "adopted images exist" test -f "$FAKE/images/loom-server:pre-k08" -a -f "$FAKE/images/loom-proxy:pre-k08"
teardown

echo "── release: no adopt when told / nothing runs"
setup
check "--no-adopt skips the adopt" bash "$ROOT/deploy/release.sh" t1 --no-backup --no-adopt
check "… so no pre-t1 image" test ! -e "$FAKE/images/loom-server:pre-t1"
teardown; setup
FAKE_PS_EMPTY=1 bash "$ROOT/deploy/release.sh" t1 --no-backup >/dev/null 2>&1
check "nothing running: releases without adopting" bash -c "test -f '$FAKE/images/loom-server:t1' && test ! -e '$FAKE/images/loom-server:pre-t1'"
teardown

echo "── backup"
setup
out="$(bash "$ROOT/deploy/backup.sh" --label nightly 2>/dev/null)"; rc=$?
check "backup exits 0" eq "$rc" 0
line="$(echo "$out" | tail -n1)"
check "last line is BACKUP" bash -c "[[ '$line' == BACKUP\ * ]]"
read -r _ db st sha <<<"$line"
check "db file" test -s "$db"
check "state file" test -s "$st"
check "no .part left" bash -c "! ls '$LOOM_BACKUP_DIR'/*.part 2>/dev/null"
check "sha verifies" bash -c "cd '$LOOM_BACKUP_DIR' && shasum -a 256 -c --quiet '$(basename "$sha")'"
check "nightly keeps pictures" bash -c "tar tzf '$st' | grep -q pictures/x.png"
check "state has guests.json" bash -c "tar tzf '$st' | grep -q './guests.json'"
check "names are UTC stamped" bash -c "[[ '$(basename "$db")' =~ ^loom-db-nightly-[0-9]{8}T[0-9]{6}Z\.sql\.gz$ ]]"
out="$(bash "$ROOT/deploy/backup.sh" --label show 2>/dev/null)"
read -r _ db2 st2 sha2 <<<"$(echo "$out" | tail -n1)"
check "show copy leaves pictures out" bash -c "! tar tzf '$st2' | grep -q pictures/"
touch -t 202001010000 "$LOOM_BACKUP_DIR/loom-db-nightly-20200101T000000Z.sql.gz"
bash "$ROOT/deploy/backup.sh" --label show --keep-days 14 >/dev/null 2>&1
check "retention prunes old files" test ! -e "$LOOM_BACKUP_DIR/loom-db-nightly-20200101T000000Z.sql.gz"
check "db down fails loudly" bash -c "FAKE_DB_DOWN=1 bash '$ROOT/deploy/backup.sh' --label x 2>&1 | grep -q 'pg_dump'"
check "bad label refused" bash -c "! bash '$ROOT/deploy/backup.sh' --label 'A B' 2>/dev/null"
check "backups are owner-only" bash -c "[ \"\$(stat -f %Lp '$db' 2>/dev/null || stat -c %a '$db')\" = 600 ]"

echo "── restore"
check "refuses the live project" bash -c "! bash '$ROOT/deploy/restore.sh' --project repo --db '$db' --state '$st' --yes 2>/dev/null"
check "refuses missing files" bash -c "! bash '$ROOT/deploy/restore.sh' --project loom-drill --db /nope --state '$st' --yes 2>/dev/null"
check "drill restore runs" bash "$ROOT/deploy/restore.sh" --project loom-drill --db "$db" --state "$st" --yes
check "psql got the dump" grep -q 'PostgreSQL database dump' "$FAKE/restored.sql"
check "state streamed in" cmp -s "$st" "$FAKE/restored.tgz"
check "used project loom-drill" grep -q -- "-p loom-drill up -d --no-build db loom" "$FAKE/calls"
check "--latest picks the newest pair" bash "$ROOT/deploy/restore.sh" --latest show --project loom-drill --yes
echo corrupt >> "$st2"
check "checksum mismatch refused" bash -c "! bash '$ROOT/deploy/restore.sh' --project loom-drill --db '$db2' --state '$st2' --yes 2>/dev/null"
check "--live allows the live name" bash "$ROOT/deploy/restore.sh" --project repo --live --db "$db" --state "$st" --yes
teardown

echo "── showbackup (house Mac)"
setup
. "$ROOT/scripts/ops/showbackup.sh"
for h in 19 20 23 00 02; do check "19-03 includes $h" in_window "$h" 19-03; done
for h in 03 12 18; do check "19-03 excludes $h" bash -c ". '$ROOT/scripts/ops/showbackup.sh'; ! in_window $h 19-03"; done
check "9-17 includes 09" in_window 09 9-17
check "always" in_window 12 always
# fake ssh runs backup.sh locally; fake scp copies local paths.
mkdir -p "$T/bin"
cat > "$T/bin/ssh" <<EOF
#!/usr/bin/env bash
cmd="\${!#}"; cd "$LOOM_DIR"; mkdir -p deploy; cp "$ROOT"/deploy/*.sh deploy/
bash -c "\${cmd#cd * && }"
EOF
cat > "$T/bin/scp" <<'EOF'
#!/usr/bin/env bash
args=(); for a in "$@"; do case "$a" in -q|-o|BatchMode=*|ConnectTimeout=*) ;; *) args+=("${a#*:}") ;; esac; done
dest="${args[${#args[@]}-1]}"; unset 'args[${#args[@]}-1]'; cp "${args[@]}" "$dest"
EOF
chmod +x "$T/bin/ssh" "$T/bin/scp"
export LOOM_NO_NOTIFY=1 SSH="$T/bin/ssh" SCP="$T/bin/scp" LAUNCHCTL=true LOOM_LOCAL_BACKUPS="$T/house" \
       LOOM_LOG_DIR="$T/logs" LOOM_LAUNCH_AGENTS="$T/agents"
check "once copies a verified pair" bash "$ROOT/scripts/ops/showbackup.sh" once
check "pair landed on the Mac" bash -c "ls '$T/house'/loom-state-show-*.tgz '$T/house'/loom-db-show-*.sql.gz '$T/house'/loom-show-*.sha256 >/dev/null"
check "log says OK" grep -q ' OK loom-state-show-' "$T/logs/showbackup.log"
sleep 1; bash "$ROOT/scripts/ops/showbackup.sh" once >/dev/null 2>&1
check "status counts two copies today" bash -c "bash '$ROOT/scripts/ops/showbackup.sh' status | grep -q 'copies today: 2 OK, 0 failed'"
check "status shows the newest" bash -c "bash '$ROOT/scripts/ops/showbackup.sh' status | grep -q 'min old'"
check "run outside the window does nothing" bash -c "LOOM_SHOW_WINDOW=0-0 bash '$ROOT/scripts/ops/showbackup.sh' run; [ \$(ls '$T/house'/*.tgz | wc -l) -eq 2 ]"
check "a VPS failure is logged + exits 1" bash -c "FAKE_DB_DOWN=1 bash '$ROOT/scripts/ops/showbackup.sh' once >/dev/null 2>&1; [ \$? -eq 1 ] && grep -q ' FAIL backup' '$T/logs/showbackup.log'"
check "install writes the plist" bash "$ROOT/scripts/ops/showbackup.sh" install
check "plist: every 600 s, run" bash -c "grep -q '<integer>600</integer>' '$T/agents/com.mapsandducks.loom-showbackup.plist' && grep -q '<string>run</string>' '$T/agents/com.mapsandducks.loom-showbackup.plist'"
check "plist is valid" bash -c "! command -v plutil >/dev/null || plutil -lint -s '$T/agents/com.mapsandducks.loom-showbackup.plist'"
check "uninstall removes it" bash -c "bash '$ROOT/scripts/ops/showbackup.sh' uninstall >/dev/null && [ ! -e '$T/agents/com.mapsandducks.loom-showbackup.plist' ]"
teardown

echo "── ship"
setup
check "ship refuses without a pre-deploy stamp" bash -c "cd '$ROOT' && ! LOOM_PREDEPLOY_STAMP=/nonexistent RSYNC=false SSH=false bash scripts/ops/ship.sh t-1 2>/dev/null"
check "ship --force --dry-run prints rsync + release" bash -c "cd '$ROOT' && bash scripts/ops/ship.sh t-1 --force --dry-run | grep -q 'deploy/release.sh t-1 --commit'"

check "ship --sync-only --dry-run syncs without releasing" bash -c "cd '$ROOT' && out=\$(bash scripts/ops/ship.sh --sync-only --force --dry-run) && echo \"\$out\" | grep -q rsync && ! echo \"\$out\" | grep -q release.sh"
check "ship merges every .gitignore into the rsync" bash -c "cd '$ROOT' && bash scripts/ops/ship.sh t-1 --force --dry-run | grep -q -- '--filter=:- .gitignore'"
# A real (listing-only) rsync over this checkout: git-ignored secrets never ship.
made=()
for f in hardware/server-room/server_room/secrets.h reinstall/vr/build/stage/config/station.json stagehand/trapped.house.local.yaml; do
  [ -e "$ROOT/$f" ] || { mkdir -p "$(dirname "$ROOT/$f")"; echo secret > "$ROOT/$f"; made+=("$f"); }
done
cat > "$T/rsync-list" <<'EOF2'
#!/usr/bin/env bash
args=(); for a in "$@"; do case "$a" in *:*/) args+=("$RSYNC_DEST/") ;; *) args+=("$a") ;; esac; done
exec rsync -n --out-format='%n' "${args[@]}"
EOF2
chmod +x "$T/rsync-list"; mkdir -p "$T/dest"
listed="$(cd "$ROOT" && RSYNC_DEST="$T/dest" RSYNC="$T/rsync-list" SSH=true bash scripts/ops/ship.sh --sync-only --force 2>/dev/null)"
check "ship lists the deploy scripts" bash -c "grep -q '^deploy/release.sh$' <<<\"\$1\"" _ "$listed"
check "ship never sends secrets.h / vr build / *.local.yaml / node_modules" bash -c "! grep -E 'secrets\.h|reinstall/vr/build/|\.local\.yaml|node_modules/|(^|/)\.env$' <<<\"\$1\"" _ "$listed"
for f in ${made[@]+"${made[@]}"}; do rm -f "$ROOT/$f"; done
rmdir -p "$ROOT/reinstall/vr/build/stage/config" 2>/dev/null || true
teardown

echo "── checklist"
check "prints the 15 pre-show boxes" bash -c "[ \$(bash '$ROOT/scripts/ops/checklist.sh' | grep -c '^\[ \]') -eq 15 ]"

echo "── syntax"
for f in "$ROOT"/deploy/*.sh "$ROOT"/scripts/ops/*.sh "$ROOT"/scripts/accept/K-08.sh; do
  [ -f "$f" ] && check "bash -n $(basename "$f")" bash -n "$f"
done

echo
echo "ops scripts: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
