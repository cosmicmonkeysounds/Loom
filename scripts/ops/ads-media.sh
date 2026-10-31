#!/usr/bin/env bash
# The audio ads (wave 59a): the fourteen MP3s, under safe names, and put on the
# VPS. They live outside git and outside the Docker images, like Clippy's dream:
# Caddy serves ~/loom-media at /media/ (docs/loom-w59-ads-contract.md C2).
#
#   scripts/ops/ads-media.sh prepare [<source dir>]  # copy them to ~/loom-media/ads
#   scripts/ops/ads-media.sh check                   # is the local set whole?
#   scripts/ops/ads-media.sh upload [--dry-run]      # rsync it to the VPS (no restart)
#   scripts/ops/ads-media.sh remote                  # what the VPS holds and serves
#
# The source folder is only ever read. Config (env or ~/.config/loom/ops.env):
# LOOM_VPS (default ubuntu@app.mapsandducks.com), LOOM_MEDIA_OUT (default
# ~/loom-media), LOOM_MEDIA_REMOTE (default loom-media, i.e. ~/loom-media),
# LOOM_ADS_SOURCE (default the WeTransfer folder in ~/Downloads).
set -euo pipefail
[ -f "$HOME/.config/loom/ops.env" ] && . "$HOME/.config/loom/ops.env"
LOOM_VPS="${LOOM_VPS:-ubuntu@app.mapsandducks.com}"
OUT="${LOOM_MEDIA_OUT:-$HOME/loom-media}/ads"
REMOTE="${LOOM_MEDIA_REMOTE:-loom-media}"
SOURCE="${LOOM_ADS_SOURCE:-$HOME/Downloads/wetransfer_spicy-ads_2026-10-29_2212}"
SSH="${SSH:-ssh}"; RSYNC="${RSYNC:-rsync}"

# Keep in step with core/src/audio-ads.ts (core/test/w59-audio-ads.test.ts reads this table).
ADS=(
  "1. Mommy Intro.MP3|ad-01-mommy-intro.mp3"
  "2. Adobe.MP3|ad-02-adobe.mp3"
  "3. Mizz Butter.MP3|ad-03-mizz-butter.mp3"
  "4. Draft King.MP3|ad-04-draft-king.mp3"
  "5. Mommy Interlude 1.MP3|ad-05-mommy-interlude-1.mp3"
  "6. Ableton Live.MP3|ad-06-ableton-live.mp3"
  "7. Horton Norton.MP3|ad-07-horton-norton.mp3"
  "8. Tippi.MP3|ad-08-tippi.mp3"
  "9. Mommy Interlude 2.MP3|ad-09-mommy-interlude-2.mp3"
  "10. V.MP3|ad-10-v.mp3"
  "11. Splenda Daddy.MP3|ad-11-splenda-daddy.mp3"
  "12. Steve.exe.MP3|ad-12-steve-exe.mp3"
  "13. Bambi.MP3|ad-13-bambi.mp3"
  "14. Mommy Outro.MP3|ad-14-mommy-outro.mp3"
)

cmd="${1:-}"; [ $# -gt 0 ] && shift
case "$cmd" in
  prepare)
    FROM="${1:-$SOURCE}"
    [ -d "$FROM" ] || { echo "✘ no such folder: $FROM" >&2; exit 1; }
    mkdir -p "$OUT"
    for row in "${ADS[@]}"; do
      src="$FROM/${row%%|*}"; dst="$OUT/${row##*|}"
      [ -s "$src" ] || { echo "✘ missing: $src" >&2; exit 1; }
      cp "$src" "$dst.part"
      mv "$dst.part" "$dst"
    done
    "$0" check
    ;;
  check)
    for row in "${ADS[@]}"; do
      f="$OUT/${row##*|}"
      [ -s "$f" ] || { echo "✘ $f is missing" >&2; exit 1; }
    done
    n="$(find "$OUT" -name 'ad-*.mp3' | wc -l | tr -d ' ')"
    [ "$n" = "${#ADS[@]}" ] || { echo "✘ $n files in $OUT, wanted ${#ADS[@]}" >&2; exit 1; }
    du -sh "$OUT"
    echo "✔ the ads are whole: $OUT"
    ;;
  upload)
    dry=(); [ "${1:-}" = "--dry-run" ] && dry=(--dry-run)
    "$0" check
    "$SSH" "$LOOM_VPS" "mkdir -p '$REMOTE/ads'"
    "$RSYNC" -a --partial --delete ${dry[@]+"${dry[@]}"} "$OUT/" "$LOOM_VPS:$REMOTE/ads/"
    echo "✔ uploaded to $LOOM_VPS:$REMOTE/ads (nothing restarted)"
    ;;
  remote)
    "$SSH" "$LOOM_VPS" "du -sh '$REMOTE'/ads ; ls '$REMOTE/ads' | wc -l"
    ;;
  *)
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit 64
    ;;
esac
