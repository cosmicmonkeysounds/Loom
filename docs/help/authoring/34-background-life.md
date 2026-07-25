---
title: Background life — scenes & generators
section: Live Shows
order: 34
keywords: SCENE, GENERATOR, coroutine, tier, ambient, focal, active, loop, wait until, yield, bark, spawn, run, at, every
---

A living world needs things happening even when the audience isn't
looking.

## Generators — ambient loops

A **GENERATOR** yields ambient content on a loop:

```loom
GENERATOR HarborChorus
  tier: ambient
  priority: 0.3

  loop
    yield bark from Quiet night. | Stars are out. | Tide's calm.
```

Or on a timer:

```loom
GENERATOR FeedHum
  tier: ambient
  every 20s
  yield bark from The feed scrolls on. | Somewhere a notification chimes.
```

A generator can also be **bound to a character** (a `generator` block
inside a CHARACTER body) — it auto-starts with them and speaks as them.
`on <condition>` delays a generator until the condition clears.

## Scenes — scripted sequences with states

A **SCENE** is a longer sequence a character runs on its own, with named
stages and waits:

```loom
SCENE patrol(character)
  loop
    wait until character.spotted_intruder
    -> investigate

SCENE investigate(character)
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
- Clock waits work too: `at 6am`, `at noon`, `at 6:30am`.

## Tiers

`tier:` sets how often a coroutine gets attention:

| Tier | Cadence | Use for |
|---|---|---|
| `focal` | constant | the thing the audience is looking at |
| `active` | frequent | nearby characters going about business |
| `ambient` | occasional | cheap background life |

## Launching them

- `<spawn: HarborChorus>` — start a coroutine alongside the visible
  beat; `<cancel: HarborChorus>` stops it.
- `<run: investigate(Wren)>` — run a scene and *wait* for it to finish
  before the beat continues.

You don't need any of this for your first show — but it's how a Loom
world keeps breathing on its own.
