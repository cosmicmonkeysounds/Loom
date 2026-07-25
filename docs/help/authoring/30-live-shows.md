---
title: Live shows — people, places, casting
section: Live Shows
order: 30
keywords: live, PERSON, ROSTER, cast, COHORT, LOCATION, participant, capacity, swings, roster, casting, immersive
---

In a live Loom show, the audience aren't just readers — they're
**participants**. They move between rooms, join sides, get scanned,
chat, and make choices, while performers run scripted and improvised
beats around them. Loom coordinates all of it.

## The four kinds of "person"

| You write | Means |
|---|---|
| `CHARACTER` (or `ROLE`) | a *part* in the script — Wren, the Sysadmin |
| `PERSON` | a *real human* who might perform — Jamie Lee |
| `ROSTER` | the plan for one night — who plays what |
| `<cast: …>` | the live act of a person taking a part |

```loom
PERSON jamie_lee
  display_name: Jamie Lee
  pronouns: they/them
  content_tolerance: [no_strobe]
```

A **ROSTER** is the line-up for a specific performance:

```loom
ROSTER preview_night
  date: 2026-05-28T19:30
  capacity: 24

  cast
    Wren     := jamie_lee
    Initiate := any of [audience]

  swings
    Wren     := [raja_park, kim_ho]
```

`:=` assigns a person to a role; `any of [audience]` means any walk-up
can fill it; `swings` lists covers. At showtime:

```loom
<load_roster: preview_night>
<cast: jamie_lee as Wren>
```

Your *script* never names a real person — the same script runs with a
different cast tomorrow.

## Groups and places: cohorts and locations

```loom
COHORT Chatters
  label: The Chatters
  capacity: 24

LOCATION Plaza
  label: The Uplink Plaza
  ambient: neon-static
  capacity: 32
```

Participants flow between cohorts and locations as the night unfolds;
your story can read those counts and memberships.

Every **location is also a chat room** — when a beat's `setting:` is a
location, its dialogue and narration land in that room, heard by whoever
is standing there (see [Chat spaces & channels](chat-rooms.md)).

## One beat, many participants: `as participant`

`self` and the `SELF` speaker let one beat serve many participants at
once, each seeing themselves in it:

```loom
on participant joins
  <enroll: participant → Initiates>
  -> orientation as participant

== orientation
  cast: self

<if: self.content_tolerance contains no_strobe>
  -> gentle_intro as self
-> standard_intro as self
```

`as participant` runs the beat *for each person*, with `self` bound to
them — checking *their* preferences, routing *them* individually, all
from one piece of writing.
