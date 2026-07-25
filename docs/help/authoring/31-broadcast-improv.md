---
title: Broadcasts & improvised beats
section: Live Shows
order: 31
keywords: broadcast, scope, location, cohort, participant, and, but, improv, duration, advance on, pedal, speech, gesture, quorum
---

## Speaking to a subset: `<broadcast:>`

In a room full of people you rarely address *everyone*.
`<broadcast: scope>` sends the lines inside it only to participants who
match:

```loom
<broadcast: location(Plaza)>
  NARRATOR
    Welcome to The Stack. Tonight, you choose a side.

<broadcast: cohort(Chatters)>
  VEX
    Camp's open. Follow me if you've had enough of being deleted.
```

The scope atoms:

| Atom | Reaches |
|---|---|
| `location(Plaza)` | everyone in the Plaza |
| `cohort(Chatters)` | everyone in the Chatters group |
| `participant(guest)` | one specific person |

Combine with `and` (both) and `but` (except):

```loom
<broadcast: cohort(Singers) and location(BellTower)>
  <cue: private_choir>

<broadcast: location(BellTower) but participant(guest)>
  NARRATOR
    The others look up. You don't.
```

## Improvised beats

Live performers don't read every word. An **improv beat** gives them a
direction and a *duration*, and hands control back when a signal
arrives:

```loom
BELLKEEPER
  (improv duration: 45s, advance on: any [pedal, speech(let us begin), gesture(Bow)])
  (Greet warmly. Find out why they came. Don't mention the singing.)
  -> next_beat
```

- `duration: 45s` — roughly how long the improv runs.
- `advance on:` — what ends it. Here *any* of: a foot `pedal`, someone
  saying "let us begin" (`speech`), or a `Bow` gesture.
- The second parenthetical is the *direction* to the performer — what to
  play, not what to say verbatim.

`advance on` can require more than one signal: `all [...]` waits for
every listed signal; `quorum(8) [...]` waits until 8 people have given
one.
