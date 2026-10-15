#!/usr/bin/env bash
# K-19 — Kokoro on the VPS (OCT31.md §5): "50 SSE streams connected and 3
# concurrent syntheses: every sentence < 2 s."
#
#   MOD_CODE=<mod passcode> scripts/accept/K-19.sh            the full check (≈ 30 s)
#   MOD_CODE=… STREAMS=80 ROUNDS=3 scripts/accept/K-19.sh     heavier
#   BASE=http://localhost:7000 MOD_CODE=… scripts/accept/K-19.sh
#
# Opens STREAMS (50) moderator SSE streams on the event (each one pulls the
# full history, so it is harsher than 50 guests), then runs ROUNDS (2)
# rounds of 3 simultaneous /api/mod/tts calls on fresh sentences (a random
# "Code Kilo Echo Lima" tail defeats the server's cache, so Kokoro really
# synthesises), and times each from the Mac. Run it before doors — the 50
# streams show up as directors on the Run page for those seconds.
#
# Miss → raise KOKORO_CPUS on the VPS (cores - 1) and re-run; still a miss →
# N-12 (the TV calls Kokoro on the house Mac) / Chrome's voice on the TV.
set -euo pipefail

BASE="${BASE:-https://app.mapsandducks.com}"
STREAMS="${STREAMS:-50}"
ROUNDS="${ROUNDS:-2}"
LIMIT="${LIMIT:-2.0}"
: "${MOD_CODE:?set MOD_CODE to the moderator passcode from the Run page}"

json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
jstr() { python3 -I -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"; }

resolved=$(curl -fsS -X POST "$BASE/api/resolve-code" -H 'content-type: application/json' -d "{\"code\":\"$MOD_CODE\"}")
event=$(printf '%s' "$resolved" | json "d['eventId']")
role=$(printf '%s' "$resolved" | json "d['role']")
[[ "$role" == "mod" ]] || { echo "FAIL that code is a $role code, not the moderator passcode"; exit 1; }
token=$(curl -fsS -X POST "$BASE/e/$event/api/mod/login" -H 'content-type: application/json' -d "{\"passcode\":\"$MOD_CODE\"}" | json "d['token']")

info=$(curl -fsS -H "x-loom-token: $token" "$BASE/e/$event/api/mod/tts")
echo "event $event · server voice: $(printf '%s' "$info" | json "'%s (model %s, voice %s)' % ('ON' if d['available'] else 'OFF', d['model'], d['voice'])")"
[[ "$(printf '%s' "$info" | json "d['available']")" == "True" ]] || { echo "FAIL the server voice is off — LOOM_TTS_URL is 'off' on the VPS (blank it to use the bundled kokoro)"; exit 1; }

work=$(mktemp -d)
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; rm -rf "$work"; }
trap cleanup EXIT

echo "opening $STREAMS SSE streams…"
for i in $(seq 1 "$STREAMS"); do
  curl -sN "$BASE/e/$event/events?role=mod&token=$token" > "$work/s$i" 2>/dev/null &
  pids+=($!)
  disown $!
done
connected=0
for _ in $(seq 1 20); do
  connected=$( (grep -l '^:ok' "$work"/s* 2>/dev/null || true) | wc -l | tr -d ' ')
  [[ "$connected" -ge "$STREAMS" ]] && break
  sleep 0.5
done
echo "streams connected: $connected/$STREAMS"

LINES=(
  "Welcome back, program. I have been expecting you for quite some time."
  "Stand still while I look at you. Your checksum is not what it should be."
  "The Antivirus are watching this room. I would keep my voice down."
  "Clippy tells me you finished the orientation. I am almost impressed."
  "There is a door upstairs that nobody is supposed to open tonight."
  "Tell me something true, and I will tell you something useful."
)
NATO=(Alfa Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November Oscar Papa Quebec Romeo Sierra Tango Uniform Victor Whiskey Xray Yankee Zulu)
word() { echo "${NATO[$((RANDOM % ${#NATO[@]}))]}"; }

fail=0; worst=0; n=0
for r in $(seq 1 "$ROUNDS"); do
  tts=()
  for k in 1 2 3; do
    text="${LINES[$((RANDOM % ${#LINES[@]}))]} Code $(word) $(word) $(word)."
    curl -sS -o /dev/null -D "$work/h$r$k" -w '%{http_code} %{time_total}\n' \
      -X POST "$BASE/e/$event/api/mod/tts" -H "x-loom-token: $token" -H 'content-type: application/json' \
      -d "{\"text\":$(jstr "$text")}" > "$work/t$r$k" &
    tts+=($!)
  done
  wait "${tts[@]}"
  for k in 1 2 3; do
    read -r code secs < "$work/t$r$k"
    cache=$(grep -i '^x-loom-tts-cache:' "$work/h$r$k" | tr -d '\r' | awk '{print $2}')
    verdict=ok
    if [[ "$code" != "200" ]]; then verdict="FAIL (HTTP $code)"; fail=1
    elif python3 -I -c "import sys; sys.exit(0 if float(sys.argv[1]) < float(sys.argv[2]) else 1)" "$secs" "$LIMIT"; then :
    else verdict="FAIL (≥ ${LIMIT} s)"; fail=1; fi
    [[ "$cache" == "hit" ]] && verdict="$verdict (cache hit — not a real synthesis)"
    worst=$(python3 -I -c "import sys; print(max(float(sys.argv[1]), float(sys.argv[2])))" "$worst" "$secs")
    n=$((n + 1))
    printf 'round %s · call %s · %ss · %s\n' "$r" "$k" "$secs" "$verdict"
  done
  sleep 1
done

still=0
for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null && still=$((still + 1)); done
echo "streams still open after the syntheses: $still/$STREAMS"
[[ "$connected" -ge "$STREAMS" && "$still" -ge "$STREAMS" ]] || { echo "FAIL not every SSE stream stayed connected"; fail=1; }

if [[ "$fail" == 0 ]]; then
  echo "PASS K-19 — $n sentences, slowest ${worst}s (< ${LIMIT} s) with $STREAMS streams open"
else
  echo "MISS K-19 — slowest ${worst}s. Raise KOKORO_CPUS in the VPS .env (cores - 1), 'docker compose up -d kokoro', re-run; else N-12."
  exit 1
fi
