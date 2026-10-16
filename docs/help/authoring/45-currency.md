---
title: Currency — a wallet over a score
section: Live Shows
order: 45
keywords: currency, wallet, coin, money, Truthcoin, balance, send, request, pay, trade, offer, buy, sell, escrow, approver, approve, deny, audit, minter, stimulus, transfer, expiry, max, window, every, limit, while, transfer_received, transfer_denied, transfer_approved, offer_accepted, stimulus_received, exchange, bank, LOOM_RL_WALLET, rate limit
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
that doesn't parse declares no currency at all, silently — a show test
that pins the currency is the guard.

Two characters may hold a **wallet role**:

```loom
CHARACTER CRA Agent Software
  wallet: approver, every 3, window 60s

CHARACTER Runescape
  wallet: minter, limit 3, while program.cleared == true
```

- **`wallet: approver[, every N][, window <duration>]`** — the auditor.
  Every Nth transfer anyone sends (default 3, counted across the whole
  night) is **held** until the approver presses Approve (or Deny); every
  other one is **pending** for the window (default 60 s) and settles on
  its own unless the approver denies it first. A denied transfer is
  refunded. A performer's part audits from its booth's Wallet room; a
  bare program (a guest's) audits from that guest's phone.
- **`wallet: minter[, limit N][, while <condition>]`** — the one program
  that can pay a **stimulus**: coin minted, not debited, to every
  program the condition holds for (default: everyone with a balance),
  at most `limit` times a night (default 3). It is a guest's program,
  so the guest presses it; the director can press it for them.

Trades (offers) never pass the approver, and a request that is paid
becomes an ordinary transfer, audited like one.

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
through the mod routes below (Run has no Wallet page yet — a balance
shows only as the guest's score in the roster and Inspector).

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
| `stimulus` | the minter | `amount`, `paid` (how many) — only for the minter's own press; a director's stimulus raises `stimulus_received` alone |
| `stimulus_received` | each recipient | `from`, `amount` |

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

**Wallet rules narrate; they never move coin.** The server has already
settled, refunded or escrowed by the time your rule runs, and it
journals each step as one line so a restart lands on the same balances
and cards. `set program.score` is still yours for prizes and fines
(the show's hosts keep 🪙 Pay / 🪙 Charge buttons as a cash bank), but
never inside a wallet rule, where it would fight the ledger.

## The routes, for show hardware

- Guests: `POST /e/:id/api/guest/wallet/{send,request,respond,offer,accept,decline,cancel,stimulus,approve,deny}` → `{ok, wallet}` (the caller's Wallet view). `approve` / `deny` only when the approver is a guest's program.
- The approver's booth: `POST /e/:id/api/prime/wallet/{approve,deny} {id}` → `{ok, queue}`.
- The director: `POST /e/:id/api/mod/wallet/{approve,deny,cancel,stimulus}` — any open item, or a stimulus when the minter's phone is gone (it still counts against the limit, but fires only `stimulus_received`, never `stimulus`); the cards read *Director*.

Every call is checked by the server (a status and a message the phone
shows), rate-limited per guest (`LOOM_RL_WALLET`, 30 a minute by
default, `<max>` or `<max>/<seconds>` — the only brake on a phone
flooding the approver's queue with tiny sends), then journaled. The
timers — the deny window, request and offer expiry — run on the story
clock, so pausing the run pauses them.

The wallet lives on the event server: a local-folder rehearsal shows
the plain ⭐ and no Wallet room ([run mode](run-mode.md)). The bank
compiler does not carry `currency:` into a game engine.
