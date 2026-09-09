---
title: Background life — scenes & generators
section: Live Shows
order: 34
keywords: SCENE, GENERATOR, coroutine, tier, ambient, focal, active, loop, wait until, yield, bark, spawn, run, at, every, cancel, wait
---

A living world needs things happening even when the audience isn't
looking.

## Generators — ambient loops

A **GENERATOR** yields ambient content on a loop:

```loom
GENERATOR Orchard Crickets
  tier: ambient
  priority: 0.3

  loop
    yield bark from Crickets. | A moth against the lantern glass. | Somewhere, a gate.
```

Or on a timer:

```loom
GENERATOR Table Murmur
  tier: ambient
  every 20s
  yield bark from Cutlery on china. | Someone laughs too loudly. | A chair scrapes back.
```

A generator can also be **bound to a character** (a `generator` block
inside a CHARACTER body) — it auto-starts with them and speaks as them.
A `when <condition>` line in the header holds a generator back until the
condition is true (`on <condition>` is the older spelling).

## Scenes — scripted sequences with states

A **SCENE** is a longer sequence a character runs on its own, with named
stages and waits:

```loom
SCENE Patrol(character)
  loop
    wait until character.spotted_intruder
    -> Investigate

SCENE Investigate(character)
  approach
    -> examine
  examine
    wait until character.deduction > 60
    -> confront
  confront
    return clue
```

- `loop` repeats; `wait until` pauses for a condition; `return` hands a
  value back.
- Bare names (`approach`, `examine`, `confront`) are the scene's states;
  `->` moves between them.
- Clock waits work too: `wait 30s`, `at 6am`, `at noon`, `at 6:30am`.

## Tiers

`tier:` sets how often a coroutine gets attention:

| Tier | Cadence | Use for |
|---|---|---|
| `focal` | constant | the thing the audience is looking at |
| `active` | frequent | nearby characters going about business |
| `ambient` | occasional | cheap background life |

## Launching them

Plain verbs, like every other instruction:

```loom
spawn Orchard Crickets
run Investigate(Ivo Marsh)
cancel Orchard Crickets
```

- `spawn` starts a coroutine alongside the visible beat; `cancel` stops
  it.
- `run` runs a scene and *waits* for it to finish before the beat
  continues — its `return` value is available to the lines after it.
- `<spawn: …>` / `<run: …>` / `<cancel: …>` are the v3 long forms and
  still work.

You don't need any of this for your first show — but it's how a Loom
world keeps breathing on its own.
