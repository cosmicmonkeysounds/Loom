---
title: Characters
section: Language
order: 15
keywords: CHARACTER, ROLE, disposition, trusts, respects, fears, reacts, knows, knowledge, hook, on, goal, properties, typed slots
---

Speakers can be just names — or real **characters** with feelings,
memory, and goals, so the story reacts to *them*.

## Declaring a character

```loom
CHARACTER Wren
  voice: female_alto
  home: Lighthouse
  hp: 80
```

Properties are `key: value` facts; you choose the keys. (`ROLE` is
another name for `CHARACTER`, used when you're thinking about casting.)

## Typed slots

A property can declare its *shape* instead of (or as well as) a value:

```loom
CHARACTER Wren
  home: any of LOCATION
  mood: calm | uneasy | afraid
  heat: range 0 to 100 = 50
  rumours: list of RUMOUR
  grudges: map of CHARACTER to int
  nickname: text?
```

- `any of KIND` — must be filled with one of that kind. A bare `any`
  slot left unfilled makes the character abstract (it won't materialise
  and you'll get a diagnostic).
- `a | b | c` — a value that moves through named stages.
- `range LO to HI = START` — a clamped number.
- `list of` / `map of … to …` — collections; `text?` — optional text.

Declared defaults are seeded into the world, so `self.heat` starts at 50
rather than appearing on first write.

## How they feel: disposition

The built-in feelings are `trusts`, `respects`, and `fears`, written as
`N of M` (N out of a maximum M):

```loom
CHARACTER Wren
  trusts Player: 30 of 100
  respects Player: 50 of 100
  fears Player: 0 of 100
```

Nudge them with `set`:

```loom
<set: Wren.trusts.Player += 20>
```

## Reacting to feelings: `reacts`

A `reacts` line names a mood the character falls into when a feeling
crosses a line:

```loom
CHARACTER Wren
  trusts Player: 30 of 100
  reacts trust > 60 -> warm
  reacts fear > 40 -> guarded
```

## What they know: `knows`

A character carries a sheet of facts — their **knowledge**:

```loom
CHARACTER Wren
  knows:
    met_player: bool = false
    bell_origin: unknown | suspects | confirmed = unknown
```

Update it like any value — `<set: Wren.knows.met_player = true>`.
Knowledge writes are schema-checked: a `bool` or staged fact rejects
out-of-band values, so typos surface immediately.

## Hooks: "when X happens, do Y"

A **hook** starts with `on` and fires automatically:

```loom
CHARACTER Wren
  on meeting Player
    <set: Wren.knows.met_player = true>
    -> greet

  on trust passes 80
    -> reveal_secret
```

| Hook | Fires when… |
|---|---|
| `on meeting X` | the character first meets X |
| `on trust passes N` | a feeling crosses N going up |
| `on trust drops below N` | …crosses N going down |
| `on enters Lighthouse` | they enter a location |
| `on exits Lighthouse` | they leave it |
| `on every 60s` | a repeating timer |
| `on participant joins` | a new participant arrives (live shows) |
| `on scan guest` | a guest scans this character (live shows) |

An inline opener is also allowed — `on scan guest -> beat` on one line.

## Goals

A **goal** is something a character is trying to achieve, tracked as a
little state machine:

```loom
CHARACTER Wren
  goal find_keeper
    priority: 0.8
    active when: true
    completes when: Wren.knows.saw_the_keeper
```

- `priority` — how much it matters (0 to 1), when goals compete.
- `active when` / `completes when` — the lifecycle conditions.
- Also available: `fails when:`, `on complete:`, `on fail:`.
