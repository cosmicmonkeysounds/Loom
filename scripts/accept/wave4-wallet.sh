#!/usr/bin/env bash
# Wave 4 — the Truthcoin wallet (OCT31.md §5 Wave 4 status). Two guest phones
# + the CRA Agent Software booth. The desk half below drives a REHEARSAL
# event over HTTP (probe guests, a few coins); the device half is printed at
# the end. ≈ 8 minutes.
#
#   MOD_CODE=… EVENT_CODE=… PRIME_CODE=… scripts/accept/wave4-wallet.sh run
#       1. registers two probe programs (Runescape — the minter — and a pool
#          program), clears them as CRA Agent Software, funds them (60 each)
#       2. send ×3 → the one the approver rule holds waits for Approve
#       3. a 4th send denied from the booth inside its 60 s window → refunded
#       4. a request, accepted → a transfer
#       5. a Runescape stimulus (minted, ≤ 3 a night)
#       6. a codex trade: a sell offer, escrowed, accepted → entry + coin move
#   MOD_CODE=… scripts/accept/wave4-wallet.sh look        the director's wallet view (read-only)
#   scripts/accept/wave4-wallet.sh device                 print the phone + booth check only
#
# BASE (default https://app.mapsandducks.com). Codes come from the Run page
# (the moderator, event and performer passcodes). `run` runs the live guard
# first: it refuses an event with real guests unless --i-know-this-is-live,
# and asks y/N unless --yes. It never touches the Antivirus booth a real
# performer holds: if CRA Agent Software is signed in elsewhere (409) the
# booth steps are done through /api/mod/wallet/* instead and say so.
set -euo pipefail
source "$(dirname "$0")/guard.sh" "$@"; set -- ${ARGS[@]+"${ARGS[@]}"}

BASE="${BASE:-https://app.mapsandducks.com}"
APPROVER="CRA Agent Software"
MINTER="Runescape"
FAIL=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAIL=1; }
json() { python3 -I -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
# post <path> <json body> [token] → the body; a non-2xx prints the error and returns 1
post() {
  local out code
  out=$(curl -sS -X POST "$BASE$1" -H 'content-type: application/json' ${3:+-H "x-loom-token: $3"} -d "$2" -w '\n%{http_code}')
  code="${out##*$'\n'}"; out="${out%$'\n'*}"
  printf '%s' "$out"
  [[ "$code" == 2* ]]
}
get() { curl -fsS "$BASE$1" -H "x-loom-token: $2"; }

device() {
  cat <<'STEPS'

Device check (≈ 8 min) — two guest phones (A and B, cleared by an Antivirus) + the CRA Agent Software booth:
  1. Both phones: the ⭐ on the pass is now the 🪙 balance; the Pinned space has a Wallet room.
  2. A → Wallet → 💸 Send → B, 5 → A's card "💸 You sent 5 Truthcoin to B — settles in 60 s
     unless CRA Agent Software denies it." A's balance drops at once; B sees nothing yet. After
     60 s (or Approve) A's card steps to ✅ settled, B's Wallet gets "💰 A sent you 5 Truthcoin."
     and B's balance rises.
  3. Repeat twice. PASS: one of the three sends says "held" — the CRA booth's Wallet room shows
     "🧾 A → B: 5" with Approve / Deny (and a 🧾 push on a locked booth) — tap Approve: both
     cards step to received, the booth's The Audit quest updates.
  4. A sends again; within 60 s the booth taps Deny: A's card "denied", the 5 is back on A.
  5. B → 🙏 Request 3 from A; A's card has Pay / Decline; Pay → a transfer; a request left
     alone expires after 10 min.
  6. The phone that picked Runescape: Wallet → 💰 Stimulus (amount, Pay everyone) → every cleared
     program gets it; the 4th reads "💰 Stimulus (none left)".
  7. A holds a codex entry: Wallet → 💱 Trade a fact → sell it to B for 4 → B's Wallet card:
     Accept / Decline. Accept: B now holds the entry, A has the coin. A buy offer escrows the
     buyer's coin until it settles.
  8. Director: there is no wallet panel in Run — approve / deny / cancel from the desk with
     `POST $EV/api/mod/wallet/{approve,deny,cancel} {id}` (mod token; `$0 look` lists the open
     items); the journal lines read Director.
STEPS
}

case "${1:-}" in
  device) device; exit 0 ;;
  look|run) ;;
  *) sed -n '2,23p' "$0"; exit 2 ;;
esac

: "${MOD_CODE:?set MOD_CODE to the moderator passcode of a REHEARSAL run}"
resolved=$(post /api/resolve-code "{\"code\":\"$MOD_CODE\"}") || { echo "FAIL the mod code does not resolve on $BASE"; exit 1; }
event=$(printf '%s' "$resolved" | json "d['eventId']")
role=$(printf '%s' "$resolved" | json "d['role']")
[[ "$role" == "mod" ]] || { echo "FAIL that code is a $role code, not the moderator passcode"; exit 1; }
token=$(post "/e/$event/api/mod/login" "{\"passcode\":\"$MOD_CODE\"}" | json "d['token']")
EV="/e/$event"
echo "event $event"

mod_view() { get "$EV/api/state?role=mod" "$token"; }
currency=$(mod_view | json "(d.get('wallet') or {}).get('name', '')")
[[ -n "$currency" ]] || { echo "FAIL this story has no currency (no \`currency:\` header, or the server predates the wallet)"; exit 1; }
ok "currency: $currency"

if [[ "$1" == "look" ]]; then
  mod_view | json "__import__('json').dumps(d.get('wallet'), indent=1)"
  exit 0
fi

: "${EVENT_CODE:?set EVENT_CODE to the event (guest) passcode}" "${PRIME_CODE:?set PRIME_CODE to the performer passcode}"
guard_writes "register 2 probe programs, clear them, fund them and move $currency between them"
stamp=$(date +%H%M%S)

# ── 1. two probe programs, cleared, funded ─────────────────────────────────
register() { # register <program name> → "id token" (empty on refusal)
  local r
  if r=$(post "$EV/api/guest/register" "{\"passcode\":\"$EVENT_CODE\",\"name\":\"$1\"}"); then
    printf '%s' "$r" | json "d['id'] + ' ' + d['token']"
  else
    echo "  (register $1 → $r)" >&2
  fi
}
read -r A A_TOKEN < <(register "$MINTER") || true
if [[ -z "${A:-}" ]]; then
  echo "  $MINTER is taken on this event — no stimulus step; A is a pool program"
  read -r A A_TOKEN < <(register "W4 Probe A $stamp")
  MINTER=""
fi
read -r B B_TOKEN < <(register "W4 Probe B $stamp")
[[ -n "${A:-}" && -n "${B:-}" ]] || { echo "FAIL could not register the probe programs"; exit 1; }
ok "programs $A (A) and $B (B)"
for g in "$A" "$B"; do
  post "$EV/api/mod/scan" "{\"as\":\"$APPROVER\",\"target\":\"$g\"}" "$token" > /dev/null || echo "  (scan $g refused — clear it from a booth)"
  post "$EV/api/mod/set" "{\"id\":\"$g\",\"field\":\"score\",\"value\":60}" "$token" > /dev/null
done
balance() { get "$EV/api/state?role=guest" "$1" | json "d['wallet']['balance']"; }
ok "cleared + funded: A $(balance "$A_TOKEN"), B $(balance "$B_TOKEN")"

# The booth: CRA Agent Software's own session, unless a real performer holds it.
booth=""
if r=$(post "$EV/api/prime/login" "{\"passcode\":\"$PRIME_CODE\",\"character\":\"$APPROVER\"}"); then
  booth=$(printf '%s' "$r" | json "d['token']"); ok "booth: signed in as $APPROVER"
else
  echo "  ($APPROVER's booth is held elsewhere: $r — the booth steps go through /api/mod/wallet/*)"
fi
approve() { if [[ -n "$booth" ]]; then post "$EV/api/prime/wallet/approve" "{\"id\":\"$1\"}" "$booth"; else post "$EV/api/mod/wallet/approve" "{\"id\":\"$1\"}" "$token"; fi; }
deny()    { if [[ -n "$booth" ]]; then post "$EV/api/prime/wallet/deny" "{\"id\":\"$1\"}" "$booth"; else post "$EV/api/mod/wallet/deny" "{\"id\":\"$1\"}" "$token"; fi; }

# ── 2. three sends: the approver rule holds every third transfer ──────────
# The view lists open items oldest first: my newest open transfer / request / offer is the one just made.
mine() { printf '%s' "$1" | json "max((x for x in d['wallet']['$2'] if x['from'] == '$3' and x['state'] in ('pending', 'held', 'open')), key=lambda x: int(x['id'][1:]))['id']"; }
tx_state() { printf '%s' "$1" | json "next(t['state'] for t in d['wallet']['transfers'] if t['id'] == '$2')"; }
held=""
for i in 1 2 3; do
  if [[ $i == 2 ]]; then from="$B_TOKEN"; me="$B"; to="$A"; else from="$A_TOKEN"; me="$A"; to="$B"; fi
  r=$(post "$EV/api/guest/wallet/send" "{\"to\":\"$to\",\"amount\":5}" "$from") || { bad "send $i → $r"; continue; }
  id=$(mine "$r" transfers "$me")
  st=$(tx_state "$r" "$id")
  echo "  send $i ($id): $st"
  [[ "$st" == "held" ]] && held="$id"
done
if [[ -n "$held" ]]; then
  if r=$(approve "$held"); then
    ok "approved $held → $(mod_view | json "next(t['state'] for t in d['wallet']['transfers'] if t['id'] == '$held')")"
  else bad "approve $held → $r"; fi
else
  bad "none of the three sends was held — the approver counts every send on the event (every 3rd): send once more and Approve it from the booth"
fi

# ── 3. deny inside the window ─────────────────────────────────────────────
before=$(balance "$A_TOKEN")
r=$(post "$EV/api/guest/wallet/send" "{\"to\":\"$B\",\"amount\":5}" "$A_TOKEN") && {
  id=$(mine "$r" transfers "$A")
  if r2=$(deny "$id"); then
    after=$(balance "$A_TOKEN")
    [[ "$after" == "$before" ]] && ok "denied $id inside the window: A back to $after" || bad "denied $id but A went $before → $after"
  else bad "deny $id → $r2"; fi
}

# ── 4. a request, accepted ────────────────────────────────────────────────
if r=$(post "$EV/api/guest/wallet/request" "{\"from\":\"$A\",\"amount\":3}" "$B_TOKEN"); then
  rid=$(mine "$r" requests "$B")
  if post "$EV/api/guest/wallet/respond" "{\"id\":\"$rid\",\"accept\":true}" "$A_TOKEN" > /dev/null; then ok "request $rid paid by A (3)"; else bad "respond to $rid refused"; fi
else bad "request → $r"; fi

# ── 5. the stimulus (Runescape only, ≤ 3 a night) ─────────────────────────
if [[ -n "$MINTER" ]]; then
  b_before=$(balance "$B_TOKEN")
  if r=$(post "$EV/api/guest/wallet/stimulus" '{"amount":2}' "$A_TOKEN"); then
    ok "stimulus by $MINTER: B $b_before → $(balance "$B_TOKEN") (uses $(printf '%s' "$r" | json "d['wallet'].get('minter')"))"
  else bad "stimulus → $r (3 already spent tonight? a non-cleared B gets nothing)"; fi
  if post "$EV/api/guest/wallet/stimulus" '{"amount":2}' "$B_TOKEN" > /dev/null 2>&1; then bad "B is not the minter but minted"; else ok "B refused the stimulus (not the minter)"; fi
fi

# ── 6. a codex trade (sell, escrowed, accepted) ───────────────────────────
code=$(get "$EV/api/mod/codes" "$token" | json "(d['codex'] or [{}])[0].get('code', '')")
entry=$(get "$EV/api/mod/codes" "$token" | json "(d['codex'] or [{}])[0].get('title', '') or (d['codex'] or [{}])[0].get('id', '')")
if [[ -n "$code" ]] && post "$EV/api/guest/codex/redeem" "{\"code\":\"$code\"}" "$A_TOKEN" > /dev/null; then
  if r=$(post "$EV/api/guest/wallet/offer" "{\"to\":\"$B\",\"side\":\"sell\",\"entry\":$(printf '%s' "$entry" | python3 -I -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"amount\":4}" "$A_TOKEN"); then
    oid=$(mine "$r" offers "$A")
    b_before=$(balance "$B_TOKEN")
    if post "$EV/api/guest/wallet/accept" "{\"id\":\"$oid\"}" "$B_TOKEN" > /dev/null; then
      ok "offer $oid accepted: B $b_before → $(balance "$B_TOKEN"), B's codex now $(get "$EV/api/state?role=guest" "$B_TOKEN" | json "len(d.get('codex') or [])") entries"
    else bad "accept $oid refused"; fi
  else bad "offer → $r"; fi
else
  echo "  (no codex code to redeem on this story — trade step skipped)"
fi

echo
echo "director's view: $0 look · journal lines: /api/mod/recap"
device
exit $FAIL
