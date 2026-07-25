---
title: The ledger — asking what happened
section: Language
order: 13
keywords: ledger, played, visits, since, history, memory, query, duration, seconds, minutes
---

Loom keeps a running record — the **ledger** — of everything that has
happened in a playthrough. You can ask it questions right inside any
condition or `{ }` interpolation.

| You write | Answers |
|---|---|
| `played(opening)` | Have we ever played the `opening` beat? (true/false) |
| `visits(opening)` | How many times? (a number) |
| `since(bell_rung)` | How long since that event? (a duration) |

```loom
<if: visits(opening) == 1>
  WREN
    First time here, I see.

<if: since(bell_rung) < 30s>
  The echo hasn't faded yet.
```

## Durations

`30s` means 30 seconds; `m` is minutes — so `5m` is five minutes. Use
them anywhere a time comparison is needed (`since(...)`, timers,
improv durations).

## Scoped queries

- `since(scope, name)` — the scoped form, when the same event name can
  fire in more than one context.
- `last(target, speaker)` — the most recent line said *to* a target *by*
  a speaker.
- `visits(...)` resolves owner-first: inside a character's owned beat,
  `visits(confront)` counts *that character's* `confront` before falling
  back to a global beat of that name.

Events to query come from `<fire: name>` (see
[Directives](directives.md)) and from the built-in envelopes a live show
emits (joins, arrivals, scans — see [Live game verbs](live-verbs.md)).
