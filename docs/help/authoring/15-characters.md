---
title: Characters
section: Language
order: 15
keywords: CHARACTER, ROLE, disposition, trusts, respects, fears, reacts, knows, knowledge, hook, on, goal, properties, typed slots, when, watcher, GROUP, LOCATION, event
---

Speakers can be just names — or real **characters** with feelings,
memory, and goals, so the story reacts to *them*.

## Declaring a character

```loom
CHARACTER Ivo Marsh
  voice: baritone
  home: The Long Table
  hp: 80
```

Declarations are the SHOUTED lines — `CHARACTER`, `LOCATION`, `GROUP`
(a side or a team), `TRAIT`, and so on. Names are any words, and the
character speaks as `Ivo Marsh:` (or `ivo marsh:` — matching ignores
case). Properties are `key: value` facts; you choose the keys.

A `ROLE` is a character sheet for *participants*: every guest at a live
show gets their own copy of the first `ROLE` in the project, so
`ROLE Guest` with a `suspicion:` property means each guest carries their
own suspicion score.

## Typed slots

A property can declare its *shape* instead of (or as well as) a value:

```loom
CHARACTER Ivo Marsh
  home: any of LOCATION
  mood: calm | uneasy | afraid
  calm: 0 to 100 = 60
  rumours: list of RUMOUR
  grudges: map of CHARACTER to int
  nickname: text?
```

- `any of KIND` — must be filled with one of that kind. A bare `any`
  slot left unfilled makes the character abstract (it won't materialise
  and you'll get a diagnostic).
- `a | b | c` — a value that moves through named stages.
- `LO to HI = START` — a clamped number.
- `list of` / `map of … to …` — collections; `text?` — optional text.

Declared defaults are seeded into the world, so `self.calm` starts at 60
rather than appearing on first write.

## How they feel: disposition

The built-in feelings are `trusts`, `respects`, and `fears`, written as
`N of M` (N out of a maximum M):

```loom
CHARACTER Ivo Marsh
  trusts Player: 30 of 100
  respects Player: 50 of 100
  fears Player: 0 of 100
```

Nudge them with `set` — a multi-word name takes underscores inside an
expression:

```loom
set Ivo_Marsh.trusts.Player += 20
```

## What they know: `knows`

A character carries a sheet of facts — their **knowledge**:

```loom
CHARACTER Ivo Marsh
  knows:
    met_player: bool = false
    bell_origin: unknown | suspects | confirmed = unknown
```

Update it like any value — `set Ivo_Marsh.knows.met_player = true`.
Knowledge writes are schema-checked: a `bool` or staged fact rejects
out-of-band values, so typos surface immediately.

## Hooks: "when X happens, do Y"

A **hook** starts with `when`, ends with a colon, and fires
automatically. The reaction is indented beneath it — any story you like:
dialogue, `set`, a divert.

```loom
CHARACTER The Gatekeeper
  patience: 0 to 10 = 3

  when scanned by guest:
    set self.patience -= 1
    -> self.Check

  when guest leaves The Cellar:
    Self: Back so soon?

  when lock_the_cellar:
    Self: Nobody else goes down tonight.
```

| Hook | Fires when… |
|---|---|
| `when scanned by guest:` | a guest scans this character's pass (live shows); `guest` is them |
| `when guest arrives at The Cellar:` | someone enters a place (`when arrives at …:` on a `ROLE` means *this* participant) |
| `when guest leaves The Cellar:` | …leaves it |
| `when guest joins The Gardeners:` | someone joins a group |
| `when someone joins:` | a new participant is created (live shows) |
| `when lockdown:` | a **named event** — anything you `fire lockdown`, or the operator fires |
| `when self.calm < 20:` | a **watcher** — the condition *becomes* true |
| `every 60s:` / `after 2m:` | a repeating timer / once, after a delay |

Little words don't matter in the event phrase — `a`, `the`, `by`, `at`,
`in`, `to`, `for`, `from`, `with` are ignored — so `when scanned by a
guest:` and `when scanned guest:` are the same hook. A lowercase word
(`guest`) is a name you can use in the body; a Capitalised word (`The
Cellar`) narrows the hook to that place or group.

**Watchers** are hooks on a *condition*. They fire once when the
condition flips from false to true, and re-arm when it goes false
again — so a feeling crossing a line, or a score reaching a threshold,
needs no special syntax:

```loom
CHARACTER Ivo Marsh
  trusts Player: 30 of 100
  calm: 0 to 100 = 60

  when self.trusts.Player > 60:
    Self (quietly): Cellar. Third door. Don't make me say it twice.

  when self.calm < 20:
    fire the_toast

ROLE Guest
  suspicion: 0 to 100 = 0
  when self.suspicion >= 70:
    move self to The Cellar
    reply Someone takes your elbow. "This way. Mind the step."
```

On a `ROLE`, a watcher runs for each participant in turn, with `self`
bound to that person. (Loom 3 wrote hooks as `on scan guest` and moods
as `reacts trust > 60 -> warm` / `on trust passes 80`; those still
parse, but a watcher does all of it.)

## Rules that belong to nobody

A `when` at the top level of a file, outside every character, is a
**story rule** — the same block, with no `self`. House-wide reactions
(`when Tension > 80:`, `when ring the bell for guest:`) live there. See
[Live verbs](live-verbs.md).

## Goals

A **goal** is something a character is trying to achieve, tracked as a
little state machine:

```loom
CHARACTER Ivo Marsh
  goal find_mara
    priority: 0.8
    active when: true
    completes when: Ivo_Marsh.knows.saw_mara
```

- `priority` — how much it matters (0 to 1), when goals compete.
- `active when` / `completes when` — the lifecycle conditions.
- Also available: `fails when:`, `on complete:`, `on fail:`.
