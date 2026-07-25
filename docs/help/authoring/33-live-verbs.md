---
title: Live game verbs
section: Live Shows
order: 33
keywords: capture, release, escape, reveal, respond, join, defect, betray, enroll, scan, signal, fire, named event, game, verbs, promote, cast
---

Live shows lean heavily on **hooks** — `on <event>` blocks that fire as
participants act. This is where a show's rules live. From *Escape the
Internet*:

```loom
CHARACTER ModBot is Algo
  on scan guest
    <capture: guest into Internet>

CHARACTER TheAdmin is Algo
  captures: 0 to 100 = 0
  on captured guest
    <broadcast: doomed to participant(guest)>
    <set: self.captures += 1>
    <if: self.captures >= 2>
      <reveal: TheAlgorithm>
```

Read it as plain English: when the ModBot scans a guest, capture them;
each time The Admin captures someone, tally it, and once it's captured
two, blow the villain's cover.

## The verb toolbox

| Directive | Does |
|---|---|
| `<capture: guest into Internet>` | move a participant into a "captured" state/location |
| `<release: guest from Internet>` | undo a capture |
| `<escape: guest>` | a captured participant breaks free (fires `on escape`) |
| `<join: guest to Chatters>` | put a participant in a faction |
| `<defect: guest from Mods to Chatters>` | switch factions (fires `on defect`) |
| `<betray: guest to TheAlgorithm>` | set a *secret* true faction |
| `<reveal: TheAlgorithm>` | expose a hidden faction to everyone |
| `<respond: text>` | send a private reply back to whoever acted (e.g. the scanned guest) |
| `<enroll: jamie_lee → Initiates>` | add a participant to a cohort |
| `<fire: lockdown>` | fire a named event every `on lockdown` hook hears |
| `<broadcast: cue to scope>` | send a cue to an audience ([scopes](broadcast-improv.md)) |
| `<cast: jamie_lee as Wren>` / `<promote: x to Role>` | bind/promote a person to a role |

## What fires hooks

**Built-in verbs** the engine fires by itself: `join`, `defect`,
`betray`, `scan`, `arrive`, `enters`, `exits`, `captured`, `released`,
`escape`, `revealed`, plus `participant joins` and timers
(`on every 60s`, `on after 2m`).

**Named events** are any other verb you hook — `on lockdown`,
`on blackout`, `on rally` — fired by `<fire: lockdown>` in the story, by
the operator from the editor's Run cockpit (the "fire named event"
picker enumerates exactly the events your hooks declare), or by show
hardware through the show-control bridge.

**Scans** are the physical layer: a performer scans a guest's QR pass in
the play app, and the scanned character's `on scan guest` hook runs with
`guest` bound to that person — deliver a beat with `-> self.beat`,
mutate their stats, capture them, or `<respond:>` privately.

## Hook parameter bindings

The lowercase word after the verb binds the acting participant:
`on scan guest` gives you `guest.*` inside the body; `on scan other`
(on a ROLE) binds the *other* party; a Capitalised word filters —
`on enters Internet` only fires for that location.
