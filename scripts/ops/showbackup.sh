#!/usr/bin/env bash
# Show-night off-box backups, run on THE HOUSE MAC (OCT31 OP-21).
# Every 10 minutes inside the show window (19:00–03:00 local) it asks the
# VPS for a fresh `deploy/backup.sh --label show` and copies the pair here,
# verifying the checksum + gzip. Last night's backup predates the show, so
# this is the copy a dead VPS gets restored from (warm standby, OCT31 §12).
#
#   scripts/ops/showbackup.sh install     # arm it (launchd, every 10 min)
#   scripts/ops/showbackup.sh status      # newest copy + age — check each act
#   scripts/ops/showbackup.sh once        # one copy now, window or not
#   scripts/ops/showbackup.sh uninstall   # disarm after the show
#   scripts/ops/showbackup.sh run         # what launchd calls (window-gated)
#
# Config (env or ~/.config/loom/ops.env):
#   LOOM_VPS            ssh destination (default ubuntu@app.mapsandducks.com)
#   LOOM_VPS_DIR        checkout on the VPS (default loom → ~/loom)
#   LOOM_LOCAL_BACKUPS  where copies land (default ~/LoomBackups)
#   LOOM_SHOW_WINDOW    "19-03" (start-end hour, end exclusive) or "always"
#   LOOM_LOCAL_KEEP_DAYS  prune local copies older than this (default 10)
#   LOOM_NOTIFY         1 = a macOS banner on a failed copy (default: none)
#   LOOM_NOTIFY_SOUND   a sound for that banner, e.g. Basso (default: silent)
# The house Mac is also the TV computer (the kiosk view=tv + the MOTU
# speakers), so a failure says nothing out loud by default: it is logged,
# and `status` shows STALE — the tech op checks it each act (OP-21). A dead
# VPS pages the crew through the uptime check, not through this job.
# ssh must work non-interactively: a key in the macOS keychain
# (`ssh-add --apple-use-keychain ~/.ssh/id_ed25519`) or a passphrase-less one.
set -uo pipefail
umask 077   # the copies hold guest tokens + the DB dump: owner-only
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
[ -f "$HOME/.config/loom/ops.env" ] && . "$HOME/.config/loom/ops.env"
LOOM_VPS="${LOOM_VPS:-ubuntu@app.mapsandducks.com}"
LOOM_VPS_DIR="${LOOM_VPS_DIR:-loom}"
LOOM_LOCAL_BACKUPS="${LOOM_LOCAL_BACKUPS:-$HOME/LoomBackups}"
LOOM_SHOW_WINDOW="${LOOM_SHOW_WINDOW:-19-03}"
LOOM_LOCAL_KEEP_DAYS="${LOOM_LOCAL_KEEP_DAYS:-10}"
LABEL="com.mapsandducks.loom-showbackup"
PLIST="${LOOM_LAUNCH_AGENTS:-$HOME/Library/LaunchAgents}/$LABEL.plist"
LOGDIR="${LOOM_LOG_DIR:-$HOME/Library/Logs/loom}"
LOG="$LOGDIR/showbackup.log"
SSH="${SSH:-ssh}"; SCP="${SCP:-scp}"; LAUNCHCTL="${LAUNCHCTL:-launchctl}"
# ConnectTimeout bounds only the connect. A path that dies under an open
# session (WAN → LTE failover: a new public IP, no RST) is noticed by the
# keepalives within ~60 s, so the run fails and the next one can start —
# launchd never starts a job that is still running.
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)

log() { mkdir -p "$LOGDIR"; printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }

# in_window HOUR WINDOW → 0 when HOUR (0–23) is inside "S-E" (wraps midnight).
in_window() {
  local h=$((10#$1)) w="$2" s e
  [ "$w" = always ] && return 0
  s=$((10#${w%-*})); e=$((10#${w#*-}))
  if [ "$s" -le "$e" ]; then [ "$h" -ge "$s" ] && [ "$h" -lt "$e" ]
  else [ "$h" -ge "$s" ] || [ "$h" -lt "$e" ]; fi
}

sha_check() { if command -v sha256sum >/dev/null; then sha256sum -c --quiet "$@"; else shasum -a 256 -c --quiet "$@"; fi; }
mtime() { stat -f %m "$1" 2>/dev/null || stat -c %Y "$1"; }

# notify_fail MSG — a banner only when asked for (LOOM_NOTIFY=1), with a
# sound only when one is named (LOOM_NOTIFY_SOUND); see the header.
notify_fail() {
  [ -n "${LOOM_NO_NOTIFY:-}" ] && return 0
  [ "${LOOM_NOTIFY:-}" = 1 ] || return 0
  local sound=""
  [ -n "${LOOM_NOTIFY_SOUND:-}" ] && sound=" sound name \"$LOOM_NOTIFY_SOUND\""
  command -v osascript >/dev/null && osascript -e "display notification \"$1\" with title \"Loom backup FAILED\"$sound" >/dev/null 2>&1
  return 0
}

once() {
  mkdir -p "$LOOM_LOCAL_BACKUPS"
  local out line db st sha
  out="$("$SSH" "${SSH_OPTS[@]}" "$LOOM_VPS" \
    "cd $LOOM_VPS_DIR && deploy/backup.sh --label show" 2>&1)" \
    || { log "FAIL backup on $LOOM_VPS: $(echo "$out" | tail -n 3 | tr '\n' ' ')"; notify_fail "VPS backup failed"; return 1; }
  line="$(echo "$out" | grep '^BACKUP ' | tail -n1)"
  [ -n "$line" ] || { log "FAIL no BACKUP line from the VPS: $(echo "$out" | tail -n 2 | tr '\n' ' ')"; notify_fail "no backup line"; return 1; }
  read -r _ db st sha <<<"$line"
  "$SCP" -q "${SSH_OPTS[@]}" "$LOOM_VPS:$db" "$LOOM_VPS:$st" "$LOOM_VPS:$sha" "$LOOM_LOCAL_BACKUPS/" \
    || { log "FAIL copy from $LOOM_VPS"; notify_fail "copy off the VPS failed"; return 1; }
  ( cd "$LOOM_LOCAL_BACKUPS" && sha_check "$(basename "$sha")" ) \
    || { log "FAIL checksum on $(basename "$sha")"; notify_fail "checksum mismatch"; return 1; }
  gzip -t "$LOOM_LOCAL_BACKUPS/$(basename "$db")" && gzip -t "$LOOM_LOCAL_BACKUPS/$(basename "$st")" \
    || { log "FAIL gzip check"; notify_fail "corrupt copy"; return 1; }
  find "$LOOM_LOCAL_BACKUPS" -maxdepth 1 -name 'loom-*' -type f -mtime +"$LOOM_LOCAL_KEEP_DAYS" -delete 2>/dev/null
  log "OK $(basename "$st") ($(du -h "$LOOM_LOCAL_BACKUPS/$(basename "$st")" | cut -f1) state, $(du -h "$LOOM_LOCAL_BACKUPS/$(basename "$db")" | cut -f1) db)"
}

run() {
  if in_window "$(date +%H)" "$LOOM_SHOW_WINDOW"; then once; else return 0; fi
}

status() {
  local newest age today n f
  newest="$(ls -1t "$LOOM_LOCAL_BACKUPS"/loom-state-show-*.tgz 2>/dev/null | head -n1)"
  if [ -n "$newest" ]; then
    age=$(( ($(date +%s) - $(mtime "$newest")) / 60 ))
    echo "newest: $(basename "$newest") — $age min old$([ "$age" -gt 15 ] && echo '  ⚠ STALE (> 15 min)')"
  else
    echo "newest: none yet in $LOOM_LOCAL_BACKUPS"
  fi
  today="$(date +%F)"
  n=$(grep -c "^$today .* OK " "$LOG" 2>/dev/null); f=$(grep -c "^$today .* FAIL " "$LOG" 2>/dev/null)
  echo "copies today: ${n:-0} OK, ${f:-0} failed"
  echo "window: $LOOM_SHOW_WINDOW   vps: $LOOM_VPS:~/$LOOM_VPS_DIR"
  if [ -f "$PLIST" ]; then echo "armed: yes ($PLIST)"; else echo "armed: NO — scripts/ops/showbackup.sh install"; fi
  [ -f "$LOG" ] && { echo "-- last log lines"; tail -n 5 "$LOG"; }
}

# The notifier knobs, carried into the plist only when they are set.
notify_keys() {
  local k
  for k in LOOM_NOTIFY LOOM_NOTIFY_SOUND; do
    [ -n "${!k:-}" ] && printf '\n    <key>%s</key><string>%s</string>' "$k" "${!k}"
  done
  return 0
}

install() {
  mkdir -p "$(dirname "$PLIST")" "$LOGDIR"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$SELF</string><string>run</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LOOM_VPS</key><string>$LOOM_VPS</string>
    <key>LOOM_VPS_DIR</key><string>$LOOM_VPS_DIR</string>
    <key>LOOM_LOCAL_BACKUPS</key><string>$LOOM_LOCAL_BACKUPS</string>
    <key>LOOM_SHOW_WINDOW</key><string>$LOOM_SHOW_WINDOW</string>$(notify_keys)
  </dict>
  <key>StandardOutPath</key><string>$LOGDIR/showbackup.launchd.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/showbackup.launchd.log</string>
</dict>
</plist>
EOF
  "$LAUNCHCTL" bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  "$LAUNCHCTL" bootstrap "gui/$(id -u)" "$PLIST" || { echo "launchctl bootstrap failed" >&2; return 1; }
  echo "armed: every 10 min inside $LOOM_SHOW_WINDOW → $LOOM_LOCAL_BACKUPS (log: $LOG)"
}

uninstall() {
  "$LAUNCHCTL" bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  rm -f "$PLIST"; echo "disarmed"
}

main() {
  case "${1:-status}" in
    once) once ;;
    run) run ;;
    status) status ;;
    install) install ;;
    uninstall) uninstall ;;
    -h|--help|help) sed -n '2,27p' "$SELF" | sed 's/^# \{0,1\}//' ;;
    *) echo "unknown command $1" >&2; return 64 ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
