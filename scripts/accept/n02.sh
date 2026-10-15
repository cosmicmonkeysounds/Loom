#!/usr/bin/env bash
# N-02 + N-10 acceptance — re-pair a lost guest, release a lost booth.
# ~8 minutes. Needs the server running a build with N-02/N-10.
#
#   0. Start a REHEARSAL in the editor (Run → Start rehearsal), then:
#      LOOM_EVENT_CODE=<guest code> LOOM_MOD_CODE=<mod code> scripts/accept/n02.sh
#      → checks both routes answer on this server (no state is changed).
#
#   N-02 (guest, < 30 s):
#   1. Phone A, Safari: join as a guest (<server>/?code=<guest code>), pick a
#      program, get through to the Desktop (clear them with a booth if needed),
#      unlock one codex entry and note your ⭐ score + Quest Log.
#   2. Phone A: Settings → Safari → Clear History and Website Data (or use
#      another phone). Reopening the link now shows the sign-in picker.
#   3. Editor: Run → roster → the guest → Inspector → 🔁 Re-pair. START A TIMER.
#   4. Phone A, CAMERA app: scan the QR → Safari opens → "Getting you back in…"
#      → you are the same program, same codex, same ⭐, same quests. STOP: < 30 s.
#      The address bar no longer shows `pair=`. Scanning the SAME QR again on
#      another phone says the code expired / was used (single use). Run's roster count did NOT grow
#      (no new guest). PASS N-02.
#
#   N-10 (performer, < 60 s):
#   5. Phone B: <server>/ → I'm a Performer → performer code → pick Clippy.
#      Post a line in a room so Clippy has history.
#   6. Kill the booth: lock Phone B / put it away (pretend it died).
#      Phone C ("the loaner"): performer code → Clippy is greyed "taken" (409).
#   7. Editor: Inspector → Clippy → ⏏ Release Clippy → Release. START A TIMER.
#   8. Phone C: refresh the cast picker → pick Clippy → the booth opens with
#      Clippy's threads and buttons. STOP: < 60 s. Phone B's booth, when woken,
#      drops to the sign-in screen. PASS N-10.
#   9. Restart the rehearsal to clear the test guests.
#
# Env: LOOM_SERVER (default https://app.mapsandducks.com).
set -uo pipefail

SERVER="${LOOM_SERVER:-https://app.mapsandducks.com}"
: "${LOOM_EVENT_CODE:?set LOOM_EVENT_CODE to the rehearsal guest code}"
: "${LOOM_MOD_CODE:?set LOOM_MOD_CODE to the rehearsal mod code}"
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s)[process.argv[1]];process.stdout.write(v==null?"":String(v))}catch{}})' "$1"; }
post() { curl -s -X POST -H 'content-type: application/json' ${3:+-H "x-loom-token: $3"} -d "$2" "$SERVER$1"; }

EVENT="$(post /api/resolve-code '{"code":"'"$LOOM_MOD_CODE"'"}' | json eventId)"
[[ -n "$EVENT" ]] || { echo "n02: $LOOM_MOD_CODE resolves to no event on $SERVER" >&2; exit 1; }
TOKEN="$(post "/e/$EVENT/api/mod/login" '{"passcode":"'"$LOOM_MOD_CODE"'"}' | json token)"
[[ -n "$TOKEN" ]] || { echo "n02: mod login failed on event $EVENT" >&2; exit 1; }

fail=0
pair="$(post "/e/$EVENT/api/mod/guest/pair" '{"id":"g-nobody"}' "$TOKEN")"
if [[ "$(printf '%s' "$pair" | json error)" == "unknown guest" ]]; then echo "  ok   /api/mod/guest/pair answers (N-02)"; else echo "  FAIL /api/mod/guest/pair: $pair"; fail=1; fi
rel="$(post "/e/$EVENT/api/mod/prime/release" '{"character":"No Such Part"}' "$TOKEN")"
if [[ "$(printf '%s' "$rel" | json error)" == "unknown character" ]]; then echo "  ok   /api/mod/prime/release answers (N-10)"; else echo "  FAIL /api/mod/prime/release: $rel"; fail=1; fi
[[ $fail == 0 ]] || { echo "n02: this server doesn't have N-02/N-10 yet — deploy first." >&2; exit 1; }
echo "  Server is ready. Now walk steps 1–9 in the header of $0 (guest code: $LOOM_EVENT_CODE)."
