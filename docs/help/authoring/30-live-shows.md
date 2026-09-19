---
title: Live shows — people, places, casting
section: Live Shows
order: 30
keywords: live, PERSON, ROSTER, cast, COHORT, LOCATION, participant, capacity, swings, roster, casting, immersive, ROLE, GROUP, hidden, someone joins, when, participant app, title
---

In a live Loom show, the audience aren't just readers — they're
**participants**. They move between rooms, pick sides, get scanned,
chat, and make choices, while performers run scripted and improvised
beats around them. Loom coordinates all of it.

## The kinds of "person"

| You write | Means |
|---|---|
| `CHARACTER` | a *part* in the script — Ivo Marsh, The Gatekeeper |
| `ROLE` | a part *many people* play at once — every guest at the party |
| `PERSON` | a *real human* who might perform — Jamie Lee |
| `ROSTER` | the plan for one night — who plays what |
| `cast who as Role` | the live act of a person taking a part |

Every participant the app creates (a pass, a join code) is cast into
your project's **first `ROLE`** unless you cast them otherwise. That
role carries the per-person state and the rules that apply to everyone:

```loom
ROLE Guest
  group: any of GROUP
  suspicion: 0 to 100 = 0
  favour: 0 to 100 = 10
  below: bool = false

  when someone joins:
    reply Welcome to the orchard. Keep your invitation where it can be scanned.
```

`when someone joins:` fires once per new participant with `self` bound
to them; `reply` sends a private line back to that one person.

## Real people: PERSON and ROSTER

```loom
PERSON jamie_lee
  display_name: Jamie Lee
  pronouns: they/them
  content_tolerance: [no_strobe]
```

A **ROSTER** is the line-up for a specific performance:

```loom
ROSTER preview_night
  date: 2026-09-12T19:30
  capacity: 30

  cast
    Ivo Marsh := jamie_lee
    Guest     := any of [audience]

  swings
    Ivo Marsh := [raja_park, kim_ho]
```

`:=` assigns a person to a part; `any of [audience]` means any walk-up
can fill it; `swings` lists covers. At showtime:

```loom
do load_roster preview_night
cast jamie_lee as Ivo Marsh
```

Your *script* never names a real person — the same script runs with a
different cast tomorrow.

## Sides, places, groupings

```loom
GROUP The Gardeners
  ethos: tend

GROUP The Society
  ethos: keep the orchard
  hidden: true

LOCATION The Cellar
  label: Under the Orchard
  ambient: drip
  capacity: 8

COHORT Early Arrivals
  label: The Early Arrivals
  capacity: 12
```

- A **GROUP** is a side a participant can be on (`FACTION` is the older
  spelling). `hidden: true` keeps it secret until the story `reveal`s
  it. `add who to Group` / `remove who from Group` change membership;
  `who.group` reads the side they're publicly on.
- A **LOCATION** is a place participants can be `move`d to — and every
  location is also a chat room: when a beat's `setting:` is a location,
  its dialogue and narration land in that room, heard by whoever is
  standing there (see [Chat spaces & channels](chat-rooms.md)).
  `hidden: true` keeps the room off a guest's phone until they have
  **stood there**, or until the story opens it — `reveal The Cellar`
  (for everyone) or `reveal The Cellar for guest` (for one person).
  `cutscene: true` puts the app **on rails** while a guest stands there:
  no rooms list, no buttons — one full-screen stream of what the story
  says *to them* (their lines, cards, decision), and a *Continue* into
  the app once the story moves them on. Use it for an arrival scene.
- A `listed: true` **CHARACTER** can be `hidden: true` too: out of the
  People directory (and, for an agent-voiced one, off every phone) until
  `reveal Name` / `reveal self`.
- A **COHORT** is a plain named grouping with a capacity, for when you
  need to count heads without it being a "side".

Your story can read all of these memberships and counts — `count(The
Gardeners)`, `guest.group == The_Gardeners` — and react to them with
`when` hooks ([Live verbs](live-verbs.md)).

## One beat, many participants

A `ROLE` hook runs *per participant*, with `self` bound to each person
in turn. Add `as self` to a divert and one beat serves everyone, each
seeing themselves in it:

```loom
ROLE Guest
  no_strobe: bool = false

  when someone joins:
    -> Orientation as self

== Orientation
  cast: self

if self.no_strobe:
  -> A Gentle Welcome as self
-> The Front Gate as self
```

Checking *their* preferences, routing *them* individually — all from one
piece of writing. (`as participant` is the older spelling and still
works.)

## The app is not the story

The participant app is a generic client. Everything it shows comes from
your project: the `# Title` line is the event name on the join screen
and lobby, your `LOCATION`s / `SPACE`s / public `GROUP`s are its rooms
sidebar, and the named events you `fire` are what the operator can
fire from the Run cockpit. Nothing story-specific is baked in.
