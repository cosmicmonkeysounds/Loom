---
title: The ledger — asking what happened
section: Language
order: 13
keywords: ledger, played, visits, since, history, memory, query, duration, seconds, minutes, fire, event
---

Loom keeps a running record — the **ledger** — of everything that has
happened in a playthrough. You can ask it questions right inside any
condition or `{ }` interpolation.

| You write | Answers |
|---|---|
| `played(Ringing)` | Have we ever played the `Ringing` beat? (true/false) |
| `visits(Ringing)` | How many times? (a number) |
| `since(bell_rung)` | How long since that event? (a duration) |

```loom
if visits(Ringing) == 1:
  Wren: First time here, I see.

if since(bell_rung) < 30s:
  The echo hasn't faded yet.
```

A beat name with spaces goes in quotes: `visits("The Bell Tower")`. A
single word needs none.

## Durations

`30s` means 30 seconds; `m` is minutes and `h` hours — so `5m` is five
minutes. Use them anywhere a time comparison is needed (`since(...)`,
timers, improv durations).

## Scoped queries

- `since(scope, name)` — the scoped form, when the same event name can
  fire in more than one context.
- `last(target, speaker)` — the most recent line said *to* a target *by*
  a speaker.
- `visits(...)` resolves owner-first: inside a character's owned beat,
  `visits(Confront)` counts *that character's* `Confront` before falling
  back to a global beat of that name.

Events to query come from `fire name` (see
[Instructions](directives.md)) and from the built-in envelopes a live
show emits (joins, arrivals, scans — see [Live game verbs](live-verbs.md)).
