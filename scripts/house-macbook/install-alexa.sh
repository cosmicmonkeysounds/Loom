#!/usr/bin/env bash
# Install (or reinstall) the fake Alexa as a LaunchAgent on a Mac (K-20).
#
# RETIRED for Trapped in the Internet (wave 18b): the speaker router (the
# `audio` launchd job) speaks the announcements now, and the two share one
# voice lock — run `--uninstall` once (scripts/house-macbook/audio.md). The
# install path stays for a house that still runs the player (a YAML with an
# `alexa:` section).
#
#   scripts/house-macbook/install-alexa.sh                    stagehand/house.yaml
#   scripts/house-macbook/install-alexa.sh --config <yaml>    another machine config
#   scripts/house-macbook/install-alexa.sh --dry-run          print the plist, load nothing
#   scripts/house-macbook/install-alexa.sh --uninstall        stop + remove the agent
#
# Logs: ~/Library/Logs/stagehand-alexa.log   Restart: launchctl kickstart -k gui/$UID/com.mapsandducks.stagehand-alexa
set -euo pipefail

LABEL=com.mapsandducks.stagehand-alexa
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
STAGEHAND="$ROOT/stagehand"
CONFIG="$STAGEHAND/house.yaml"
DRY=0
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/stagehand-alexa.log"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config) CONFIG="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --uninstall)
      launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
      rm -f "$TARGET"
      echo "removed $LABEL"; exit 0 ;;
    *) echo "unknown argument $1"; exit 2 ;;
  esac
done

UV="$(command -v uv || true)"
[[ -n "$UV" ]] || { echo "FAIL uv is not on PATH (brew install uv)"; exit 1; }
if [[ ! -f "$CONFIG" ]]; then
  cat <<MSG
FAIL no machine config at $CONFIG
  cp $STAGEHAND/trapped.house.yaml $STAGEHAND/house.yaml
  then set server.url (https://app.mapsandducks.com), server.event and
  server.mod_passcode, and alexa.device (uv run python -m sounddevice).
MSG
  exit 1
fi

if ! grep -q '^alexa:' "$CONFIG"; then
  cat <<MSG
FAIL $CONFIG has no alexa: section — the speaker router speaks the
  announcements (wave 18b). Retire the player instead:
  $0 --uninstall
  then: uv run stagehand launchd install --job audio --config <yaml>  (scripts/house-macbook/audio.md)
MSG
  exit 2
fi

# Validate before installing — a bad config should fail here, not loop in launchd.
(cd "$STAGEHAND" && "$UV" run stagehand check --config "$CONFIG" --only alexa)

PLIST="$(sed \
  -e "s#__UV__#$UV#g" \
  -e "s#__STAGEHAND__#$STAGEHAND#g" \
  -e "s#__CONFIG__#$CONFIG#g" \
  -e "s#__LOG__#$LOG#g" \
  -e "s#__PATH__#$(dirname "$UV"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin#g" \
  "$HERE/$LABEL.plist")"

if [[ $DRY == 1 ]]; then
  printf '%s\n' "$PLIST"; exit 0
fi

mkdir -p "$(dirname "$TARGET")" "$(dirname "$LOG")"
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
printf '%s\n' "$PLIST" > "$TARGET"
plutil -lint "$TARGET" > /dev/null
launchctl bootstrap "gui/$UID" "$TARGET"
sleep 2
launchctl print "gui/$UID/$LABEL" | grep -E "state =|pid =" || true
echo "installed $LABEL — log: tail -f $LOG"
