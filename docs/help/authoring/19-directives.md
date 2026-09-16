---
title: Instructions — verbs, cues, and the long form
section: Language
order: 19
keywords: directive, sfx, cue, pause, flash, anchor, fire, set, goal, spawn, run, broadcast, angle brackets, luau, extension, instruction, verb, sound, reply, move, add, remove, reveal, do, long form, show, widget, captcha
---

An **instruction** is a plain lowercase verb at the start of a line —
`set`, `cue`, `fire` — telling the runtime to *do* something. Some take
arguments (`cue lx_dawn`); some take none (`pause`); block-openers end
with a colon and own everything indented beneath them (`if coins > 5:`).

```loom
Wren (startled): Lightning?

sound distant_thunder
pause
set storm = true
```

## The verb table

| Verb | Does |
|---|---|
| `set path = value` (`+=` `-=` `*=` `/=`) | change a value ([Memory](memory.md)) |
| `if cond:` / `else if cond:` / `else:` | branch |
| `match value:` + `arm:` lines | pick an arm by value |
| `each visit:` + `first:` `then:` `finally:` | vary on revisit ([Variety](variety.md)) |
| `after cond:` / `otherwise:` | swap content at a turning point |
| `let name = expr` | a live, self-updating binding |
| `cycle a \| b` / `shuffle a \| b` | variety |
| `cue lx_dawn` | fire a lighting/tech cue |
| `sound bell_toll` (or `sfx`) | play a sound effect |
| `pause` | hold for a beat |
| `flash white, 200` | a 200 ms white flash |
| `anchor the_bell_rings` | name this spot in the story (tests, analytics, show control) |
| `fire bell_acknowledged` | raise a named event other hooks can listen for |
| `fire rally for guest` | …carrying who it's about |
| `fire alarm with level: 3` | …carrying details (`{level}` in the listening body) |
| `reply You slip the key into your pocket.` | a private line back to whoever acted |
| `show captcha "Pick the traffic lights" to guest` | put a card in the conversation — a CAPTCHA, a picture, a poll ([Cards & widgets](widgets.md)) |
| `move guest to The Cellar` | put a participant somewhere |
| `add guest to The Gardeners` / `remove guest from The Gardeners` | group membership |
| `reveal The Society` | make a hidden group public |
| `cast guest as Gatekeeper` | casting |
| `broadcast lantern_low to location(The Cellar)` | send a cue to an audience |
| `spawn` / `run` / `cancel` / `wait` | coroutines |
| `do verb args` | any custom verb |
| `return` | come back from a tunnel |

`fire` lets one part of the story send a signal that another part — a
`when lockdown:` hook on any character — reacts to, without direct
wiring. It's how a story invents its own vocabulary: see
[Characters](characters.md).

The live-show verbs (`move`, `add`, `remove`, `reveal`, `reply`,
`broadcast`) are covered in [Live game verbs](live-verbs.md); `spawn` /
`run` / `cancel` in [Background life](background-life.md).

## How Loom tells an instruction from prose

The verb must be **lowercase, at the start of the line**, and shaped
like its job: `set` needs `name = value`; `move` needs a `to`; `add` a
`to`, `remove` a `from`; `cue` / `sound` / `fire` / `anchor` a single
name; a block-opener its trailing colon. Anything else is narration —
*Move slowly through the dark.* is prose, `move guest to The Cellar` is
an instruction. To force a line that fits a verb's shape to stay prose,
start it with `\`.

## The long form: `<verb: args>`

Angle brackets are the same instruction written *inside* a line — the
only way to fire an effect mid-sentence:

```loom
Wren (startled): Lightning?<flash: white, 200>
```

Every verb in the table has this spelling (`<cue: lx_dawn>`,
`<set: storm = true>`), and it is how Loom 3 wrote all of them. It still
works everywhere; the bare verb just reads better as a full line.

## Custom verbs: `do` and extensions

A verb the runtime doesn't recognise can be defined by an extension (a
`.luau` file shipping `directive name(args) … end`) or handled by the
show-control bridge. Call it with `do` as a line, or with the long form
mid-line:

```loom
do goal Wren/find_keeper complete
do vibe dread
Wren: Hold this.<prop: lantern, light>
```

In the browser and in live events, unknown verbs (`cue`, `prop`, `vibe`,
…) degrade to logged events instead of stopping the story — which is
exactly what makes them useful as show-control cues; see
[Live game verbs](live-verbs.md).

The long form also opens a block when a verb wraps a chunk of story —
everything indented beneath belongs to it:

```loom
<broadcast: location(The Long Table)>
  Narrator: Welcome to the orchard. Tonight, you choose a side.
```

The rule is consistent everywhere in Loom: **indentation shows what
belongs to what.**
