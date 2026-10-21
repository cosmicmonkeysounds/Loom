---
title: Currency — a wallet over a score
section: Live Shows
order: 45
keywords: flagged, MyCRA, as, audit phrase, currency, wallet, coin, money, Truthcoin, balance, send, request, pay, trade, offer, buy, sell, escrow, approver, approve, deny, audit, minter, stimulus, reserve, grant, freeze, frozen, transfer, expiry, max, window, every, limit, while, transfer_received, transfer_denied, transfer_approved, offer_accepted, stimulus_received, exchange, bank, LOOM_RL_WALLET, rate limit, escrowed
---

A score is a number the story moves. A **currency** is a score the
guests move themselves — sending it to each other, asking for it,
trading lore for it — with the story watching. *Trapped in the
Internet* runs on Truthcoin.

## Declaring it

One line in the header, over an existing ROLE slot:

```loom
# Trapped in the Internet
currency: score as Truthcoin, max 500, expiry 10m
```

`currency: <slot> as <Name>[, max N][, expiry <duration>]` — the slot
is the per-person variable the balance lives in (`program.score`
stays exactly what it was: `set program.score += 50`, the roster
column and the recap all keep working), the name is what the phones
show. `max` caps one transfer (default 500); `expiry` is how long a
request or an offer waits for an answer (default 10 minutes). A line
that doesn't parse declares no currency at all, so the editor's lint
(and `loomcheck`) flags it as an error, `L1203`; a `wallet:` line that
doesn't parse is `L1204`.

Two characters may hold a **wallet role**:

```loom
CHARACTER CRA Agent Software
  wallet: approver, every 3, window 60s

CHARACTER Runescape
  wallet: minter, limit 3, while program.cleared == true
```

- **`wallet: approver[, every N][, window <duration>]`** — the auditor.
  Every Nth transfer anyone sends (default 3, counted across the whole
  night) is **held** until the approver presses Approve (or Deny), or
  for five minutes at most: a held transfer nobody answers goes through
  on its own (*approved automatically*, and no `transfer_approved` — a
  timeout is nobody's approval). Every other one is **pending** for the
  window (default 60 s) and settles on its own unless the approver
  denies it first. A denied transfer is refunded. A performer's part audits from its booth's Wallet room; a
  bare program (a guest's) audits from that guest's phone.
  Two more clauses name the audit on the guests' cards: **`as <name>`**
  is what the wallet cards call the approver (`as MyCRA`; its booth and
  the character keep their own name), and **`audit "<phrase>"`** what a
  held transfer is flagged for. Both parties of a held transfer then see
  it flagged: *🚩 Flagged for a CRA audit: must be approved by MyCRA*,
  a small moment on each phone.

```loom
CHARACTER CRA Agent Software
  wallet: approver, every 3, window 60s, as MyCRA, audit "a CRA audit"
```
- **`wallet: minter[, limit N][, while <condition>][, grants N][, freeze <dur>]`**
  — the one program that holds the **reserve**. It can pay a
  **stimulus**: coin minted, not debited, to every program the
  condition holds for (default: everyone with a balance), at most
  `limit` times a night (default 3). It can **grant** one such program
  coin from the reserve, `grants` times a night (default 3). And it can
  **freeze** any program's coin for `freeze` (default 10m, on the story
  clock, so a pause stops it): until it thaws, that program can't send,
  pay a request, make a buy offer or accept a sell offer (coin still
  comes in; declining and cancelling still work), and one program
  carries one freeze at a time. It is a guest's program, so the guest
  presses it; the director can press any of it for them (a director's
  grant counts against the limit).

Trades (offers) never pass the approver, and a request that is paid
becomes an ordinary transfer, audited like one. When that payment
settles, is denied or is cancelled, the request's card closes in both
parties' Wallets (*✅ Paid — you sent 40 Truthcoin* on the payer's, *✅
Paid — Paint sent 40 Truthcoin* on the asker's). A card closed by
someone names them, as a display name (*Director*, a guest's name, *CRA
Agent Software*), and each side reads it its own way: *⛔ CRA Agent
Software denied your payment of 40 Truthcoin; refunded.* on the payer's
thread, *… denied DraftKings' payment …* on the asker's; *↩️ You
cancelled the payment* / *↩️ Director cancelled your payment*. A
director closing a request nobody paid reads *↩️ Director cancelled
Paint's request for 40 Truthcoin.*, never as the asker's withdrawal.

Coin moves between guests only. A send or a request to a character
answers 404 *unknown recipient* (a performer has no wallet), so a game
with stakes settles player to player: the winner sends a 🙏 request,
the loser pays.

## What the guests get

A pinned **🪙 Wallet** room (beside the Quest Log and the Codex), whose
line reads *🪙 120 Truthcoin · 2 pending*; the ⭐ on their card becomes
the balance. Its footer: **💸 Send** (pick a person, an amount),
**🙏 Request** (they get a card with Pay / Decline), **💱 Trade a fact**
(offer one of your codex entries for coin, or coin for one of theirs;
the other side gets Accept / Decline; on accept the server moves the
coin **and** shares the entry — one journaled step, escrowed until then
so neither side can spend it twice), and, for the minter, **💰 Stimulus
(N left)**. Every step of every deal is a card in both parties'
Wallet rooms with its own thread (*💸 You sent 50 Truthcoin to Excel —
settles in 42 s unless CRA Agent Software denies it* → *✅ settled*).
The approver's room lists what is waiting on them; the director acts
from the **Wallet** card on Run's front page (a server run): the
approver, the minter and the stimulus count with **💰 Pay stimulus**,
every open transfer with a countdown and Approve / Deny / Cancel (a
held one also clears with **✓ Approve all held**), open requests and
offers with Cancel, the minter's freezes in force with **☀ Lift**, and
everyone's balance — the same mod routes below.

Amounts are whole numbers from 1 to `max`; a send needs the balance; a
guest can't pay themselves and may have a handful of open requests at
once. The phone shows the refusal as it came (*insufficient funds*,
*no stimulus left*).

## Hearing it: the events

The server fires these as named events, with person ids bound as the
subject and the `from` / `to` arguments, so they bind as programs in
your rules; `amount`, `tx` / `request`, `entry`, `side` and `by` (the
approver's name, or `Director`) are values.

| Event | For whom | Args |
|---|---|---|
| `transfer_sent` | the sender | `to`, `amount`, `tx`, `state` (`held` / `pending` / `settled`) |
| `transfer_held` | the sender | `to`, `amount`, `tx` — waiting for the approver |
| `transfer_received` | the recipient | `from`, `amount`, `tx` — the coin landed |
| `transfer_approved` / `transfer_denied` / `transfer_cancelled` | the sender | `to`, `amount`, `tx`, `by` |
| `request_sent` | the one asked | `from`, `amount`, `request` |
| `request_declined` / `request_expired` / `request_cancelled` | the asker | `to`, `amount`, `request` |
| `offer_made` | the one offered to | `from`, `amount`, `entry`, `side` (`buy` / `sell`) |
| `offer_accepted` / `offer_declined` / `offer_expired` / `offer_cancelled` | the offerer | `to`, `amount`, `entry`, `side` |
| `stimulus` | the minter | `amount`, `paid` (how many); a director's press fires it too, as the minter's program, with `by` (who pressed it) — and not at all when no guest plays the minter |
| `stimulus_received` | each recipient | `from`, `amount` |
| `grant` / `grant_received` | the minter / the recipient | `to` / `from`, `amount` — `grant` only for the minter's own press |
| `freeze` | the minter | `to`, `until` (story ms) — only for the minter's own press |
| `wallet_frozen` / `wallet_thawed` | the frozen program | `from`, `until` / `by` (only when a director lifted it early) |

An accepted trade also fires `share` and `learns` for the entry, like
any share ([lore](codex.md)).

```loom
ROLE Program
  when transfer_received for program:
    broadcast "🪙 {from.name} → {program.name}: {amount} Truthcoin" to channel(truthcoin exchange)
  when transfer_denied for program:
    broadcast "🧾 Denied: {program.name} → {to.name}, {amount} Truthcoin. Refunded." to channel(hosts)
    update quest The Audit for CRA Agent Software "Denied {program.name} → {to.name}, {amount}."
  when stimulus for program:
    broadcast "!💰 Truthcoin stimulus: {program.name} sends every program {amount}." to everyone
    set Night.stimulus_n += 1
```

## Coin in flight: `escrowed`

A send leaves the sender's balance at once but reaches the recipient
only when it settles, and a buy offer's coin sits in escrow until it is
accepted, declined or expires. The story sees that coin as
`<who>.escrowed`: everything a person has in pending or held sends plus
open buy-offer escrow. The server keeps it up to date on every step
(it rises before a debit and falls after a credit, so `score +
escrowed` never dips mid-step and a watcher can't fire early), and it
replays with the journal. It needs no slot: unset, it reads as nothing
in a sum (or an addition). A majority that counts every coin in the
room, including what is still on its way:

```loom
ROLE Program
  when (self.score + self.escrowed) * 2 > sum([p.score + p.escrowed for p in Persons]):
    set self.majority = true
```

**Wallet rules narrate; they never move coin.** The server has already
settled, refunded or escrowed by the time your rule runs, and it
journals each step as one line so a restart lands on the same balances
and cards. `set program.score` is still yours for prizes and fines
(the show's hosts keep 🪙 Pay / 🪙 Charge buttons as a cash bank), but
never inside a wallet rule, where it would fight the ledger.

## The routes, for show hardware

- Guests: `POST /e/:id/api/guest/wallet/{send,request,respond,offer,accept,decline,cancel,stimulus,grant,freeze,approve,deny}` → `{ok, wallet}` (the caller's Wallet view). `approve` / `deny` only when the approver is a guest's program; `grant {to, amount}` and `freeze {to}` only for the minter. A frozen view carries `frozenUntil` (story ms); the minter's carries `minter.grants`, `minter.freezeMs` and `minter.frozen` (the freezes in force).
- The approver's booth: `POST /e/:id/api/prime/wallet/{approve,deny} {id}` → `{ok, queue}`.
- The director: `POST /e/:id/api/mod/wallet/{approve,deny,cancel,stimulus,grant,freeze,unfreeze}` — any open item, a stimulus / grant / freeze when the minter's phone is gone, or `unfreeze {to}` (or `{id}`) to lift a freeze early. A stimulus from here still counts against the limit and fires `stimulus` exactly as the minter's own press would (the minter's program is the subject, `by` names the director), so one `when stimulus for program:` covers both; with no guest playing the minter only `stimulus_received` fires. The cards read *Director*. `POST /e/:id/api/mod/wallet/approve-held` approves every held transfer at once (the approver's booth is empty) → `{ok, approved: [ids], wallet}`.
- A **restricted** guest ([live verbs](live-verbs.md)) gets 403 on `send`, `request`, `respond`, `offer`, `accept`, `stimulus`, `grant` and `freeze`; `decline` and `cancel` still work, and the director's routes are never blocked.
- A trade names its entry by id or by its display title. A buy of no entry at all is a 409 *they don't have that to sell*; a buy never checks what the other side holds (that would tell the buyer someone's secret entries), so an offer for an entry they lack reaches them and fails on Accept, refunding the coin. A refused offer still counts against `LOOM_RL_WALLET`, so guessing titles is slow.

- **The casino terminal** (`/terminal/?…&view=casino`): `POST /e/:id/api/mod/casino/bet {guest, game, pick, stake, label?}` (mod token) → `{ok, game, pick, stake, roll, payout, net, balance, unit}`. The server throws the dice (`@loom/core/casino`: `coin` heads / tails 2× with a 1-in-20 edge for the house; `dice` under / over 7 2×, seven 5×; `slots` pull, three weighted reels, up to 40×), takes the stake and pays `payout` (stake included) as one journaled wallet `bet` op — the roll rides the op, so a replay never rolls again. Stakes are whole numbers from 1 to 50 and never more than the balance; a restricted guest gets 403, a frozen wallet 409, closed doors 409, a second bet inside 700 ms 429. The guest's Wallet room gets one 🎰 card per sitting (bets ten story-minutes apart open a new one), and the story hears **`casino won`** / **`casino lost`** for the guest (`game`, `stake`, `payout`, `net`; a push fires nothing). The director's mirror carries the night's `casino {bets, staked, paid}`.

Every call is checked by the server (a status and a message the phone
shows), rate-limited per guest (`LOOM_RL_WALLET`, 30 a minute by
default, `<max>` or `<max>/<seconds>` — the only brake on a phone
flooding the approver's queue with tiny sends), then journaled. Backing
out is never rate-limited: `decline`, `cancel` and declining a request
(`respond` without `accept: true`) still work over the limit. The
timers — the deny window, a held transfer's five minutes, request and
offer expiry — run on the story clock, so pausing the run pauses them.

The wallet lives on the event server: a local-folder rehearsal shows
the plain ⭐ and no Wallet room ([run mode](run-mode.md)). The bank
compiler does not carry `currency:` into a game engine.
