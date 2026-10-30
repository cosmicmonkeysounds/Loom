#!/usr/bin/env bash
# Clippy's dream (wave 50): the hour-long video, made fit to stream, and put
# on the VPS. It lives outside git and outside the Docker images: Caddy serves
# ~/loom-media at /media/ (docs/loom-w50-contract.md C2).
#
#   scripts/ops/dream-media.sh encode <source.mp4>   # write ~/loom-media/dream
#   scripts/ops/dream-media.sh check                 # is the local set whole?
#   scripts/ops/dream-media.sh upload [--dry-run]    # rsync it to the VPS (no restart)
#   scripts/ops/dream-media.sh remote                # what the VPS holds and serves
#
#   dream-720.mp4   the TV: 1280x720, 20 fps, no audio, ~1.4 Mbps
#   dream-480.mp4   the walls: 854x480, 20 fps, no audio, ~0.65 Mbps
#   frames/         3 JPEGs a second, 320x240, 000001.jpg…: the games' terminals
#                   (their camera feed route), and any wall whose video fails
#
# A keyframe every 2 s and the index up front: a terminal seeks straight to
# its own spot over byte ranges. Config (env or ~/.config/loom/ops.env):
# LOOM_VPS (default ubuntu@app.mapsandducks.com), LOOM_MEDIA_OUT (default
# ~/loom-media), LOOM_MEDIA_REMOTE (default loom-media, i.e. ~/loom-media).
set -euo pipefail
[ -f "$HOME/.config/loom/ops.env" ] && . "$HOME/.config/loom/ops.env"
LOOM_VPS="${LOOM_VPS:-ubuntu@app.mapsandducks.com}"
OUT="${LOOM_MEDIA_OUT:-$HOME/loom-media}/dream"
REMOTE="${LOOM_MEDIA_REMOTE:-loom-media}"
SSH="${SSH:-ssh}"; RSYNC="${RSYNC:-rsync}"
# Keep in step with @loom/house dream.ts: DREAM_SECONDS × DREAM_FRAME_FPS.
FRAMES=10800

video() { # <output> <width> <height> <profile> <level> <crf> <maxrate> <bufsize>
  ffmpeg -v error -stats -y -i "$SRC" -an \
    -vf "scale=$2:$3:flags=lanczos,format=yuv420p" \
    -c:v libx264 -preset slow -profile:v "$4" -level "$5" -crf "$6" -maxrate "$7" -bufsize "$8" \
    -g 40 -keyint_min 20 -movflags +faststart "$1.part.mp4"
  mv "$1.part.mp4" "$1"
}

cmd="${1:-}"; [ $# -gt 0 ] && shift
case "$cmd" in
  encode)
    SRC="${1:?usage: dream-media.sh encode <source.mp4>}"
    mkdir -p "$OUT/frames"
    video "$OUT/dream-480.mp4" 854 480 main 3.1 27 1000k 2000k
    video "$OUT/dream-720.mp4" 1280 720 high 3.1 26 2000k 4000k
    ffmpeg -v error -stats -y -i "$SRC" -an \
      -vf "fps=3,crop=ih*4/3:ih,scale=320:240:flags=lanczos" -q:v 9 \
      -frames:v "$FRAMES" -start_number 1 "$OUT/frames/%06d.jpg"
    "$0" check
    ;;
  check)
    for f in dream-480.mp4 dream-720.mp4; do
      [ -s "$OUT/$f" ] || { echo "✘ $OUT/$f is missing" >&2; exit 1; }
    done
    n="$(find "$OUT/frames" -name '*.jpg' | wc -l | tr -d ' ')"
    [ "$n" = "$FRAMES" ] || { echo "✘ $n frames in $OUT/frames, wanted $FRAMES" >&2; exit 1; }
    du -sh "$OUT"/dream-480.mp4 "$OUT"/dream-720.mp4 "$OUT"/frames
    echo "✔ the dream is whole: $OUT"
    ;;
  upload)
    dry=(); [ "${1:-}" = "--dry-run" ] && dry=(--dry-run)
    "$0" check
    "$SSH" "$LOOM_VPS" "mkdir -p '$REMOTE/dream'"
    "$RSYNC" -a --partial --delete ${dry[@]+"${dry[@]}"} "$OUT/" "$LOOM_VPS:$REMOTE/dream/"
    echo "✔ uploaded to $LOOM_VPS:$REMOTE/dream (nothing restarted)"
    ;;
  remote)
    "$SSH" "$LOOM_VPS" "du -sh '$REMOTE'/dream/* ; ls '$REMOTE/dream/frames' | wc -l"
    ;;
  *)
    sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
    exit 64
    ;;
esac
