#!/usr/bin/env bash
# K-08 acceptance (restore drill Wed 10-21; the 10-min job check Sun 10-25),
# run ON THE HOUSE MAC in the repo. ~10 minutes. It drives the VPS over ssh:
#
#   scripts/accept/K-08.sh [nightly|show]     # which backup to restore (default nightly)
#
#   1. one show-night copy VPS → this Mac, checksummed   (scripts/ops/showbackup.sh once)
#   2. restore drill: the newest backup into a scratch project `loom-drill`
#      on the VPS (own volumes, no Caddy) → an old guest token still reads
#      its view                                           (deploy/restore.sh --check)
#   3. rollback timing: previous tag and back, each < 5 min (asks first —
#      it restarts the LIVE site twice, ~30 s each)
#   4. the 10-min job: armed, and ≥ 2 OK copies today (the 10-25 criterion)
#
# Needs: ssh to $LOOM_VPS without a prompt, the deploy/ scripts shipped to
# the VPS (scripts/ops/ship.sh), at least one release logged
# (deploy/release.sh --adopt <tag> if nothing was released yet), and for
# step 2 a backup taken after someone registered on an event.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$HOME/.config/loom/ops.env" ] && . "$HOME/.config/loom/ops.env"
VPS="${LOOM_VPS:-ubuntu@app.mapsandducks.com}"
DIR="${LOOM_VPS_DIR:-loom}"
WHICH="${1:-nightly}"
PASS=0; FAIL=0
ok()   { echo "  ✔ $*"; PASS=$((PASS+1)); }
bad()  { echo "  ✘ $*"; FAIL=$((FAIL+1)); }
step() { echo; echo "── $*"; }
remote() { ssh -o BatchMode=yes -o ConnectTimeout=15 "$VPS" "cd $DIR && $*"; }

step "0. preflight"
remote true 2>/dev/null && ok "ssh $VPS" || { bad "ssh $VPS fails non-interactively (ssh-add --apple-use-keychain …)"; exit 1; }
remote "test -x deploy/restore.sh && test -x deploy/rollback.sh" && ok "deploy scripts on the VPS" \
  || { bad "deploy/*.sh missing on the VPS — ship first (scripts/ops/ship.sh <tag>)"; exit 1; }
remote "deploy/release.sh --list" | sed 's/^/    /'
CUR="$(remote "grep '^LOOM_TAG=' .env | tail -n1 | cut -d= -f2")"
[ -n "$CUR" ] && ok "pinned tag: $CUR" || bad "no LOOM_TAG in the VPS .env — run deploy/release.sh (or --adopt <tag>)"

step "1. one show-night copy off the box"
if LOOM_VPS="$VPS" LOOM_VPS_DIR="$DIR" "$ROOT/scripts/ops/showbackup.sh" once; then ok "copied + verified"; else bad "show copy failed (log: ~/Library/Logs/loom/showbackup.log)"; fi

step "2. restore drill ($WHICH) into loom-drill on the VPS"
remote "ls ~/loom-backups/loom-$WHICH-*.sha256 >/dev/null 2>&1" || { echo "    no $WHICH backup yet — using the show copy from step 1"; WHICH=show; }
T0=$(date +%s)
if remote "deploy/restore.sh --latest $WHICH --project loom-drill --check --yes"; then
  ok "restored in $(( $(date +%s) - T0 )) s and an old guest token reads its view"
else
  bad "restore drill failed (see above)"
fi
remote "docker compose -p loom-drill down -v" >/dev/null 2>&1 && ok "drill torn down" || bad "tear down by hand: docker compose -p loom-drill down -v"

step "3. rollback < 5 min (restarts the LIVE site twice)"
read -r -p "  → do it now? [y/N] " yn
if [ "$yn" = y ] || [ "$yn" = Y ]; then
  T0=$(date +%s)
  if remote "deploy/rollback.sh"; then
    D=$(( $(date +%s) - T0 )); [ "$D" -lt 300 ] && ok "rolled back in $D s" || bad "rollback took $D s (> 300)"
    T0=$(date +%s)
    if remote "deploy/rollback.sh $CUR"; then
      D=$(( $(date +%s) - T0 )); [ "$D" -lt 300 ] && ok "back on $CUR in $D s" || bad "roll-forward took $D s"
    else bad "could not return to $CUR — run: ssh $VPS 'cd $DIR && deploy/rollback.sh $CUR'"; fi
  else
    bad "rollback failed (no previous release? deploy/release.sh --list)"
  fi
else
  echo "    skipped"
fi

step "4. the 10-min show-night job"
ST="$("$ROOT/scripts/ops/showbackup.sh" status)"; echo "$ST" | sed 's/^/    /'
echo "$ST" | grep -q '^armed: yes' && ok "armed (launchd)" || bad "not armed — scripts/ops/showbackup.sh install"
N=$(echo "$ST" | sed -n 's/^copies today: \([0-9]*\) OK.*/\1/p')
[ "${N:-0}" -ge 2 ] && ok "$N OK copies today" || bad "only ${N:-0} OK copies today (needs 2 — on 10-25 leave it armed ≥ 20 min inside the window, or LOOM_SHOW_WINDOW=always)"

echo
echo "K-08: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
