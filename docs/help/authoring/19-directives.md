---
title: Directives — the < > toolbox
section: Language
order: 19
keywords: directive, sfx, cue, pause, flash, anchor, fire, set, goal, spawn, run, broadcast, angle brackets, luau, extension
---

The angle-bracket commands — `<set:>`, `<if:>`, `<cycle:>` — are
**directives**: instructions to the runtime. A directive is
`<name: arguments>`; some take no arguments (`<pause>`); some open an
indented block.

A directive fires at exactly the point it appears in the text — even
mid-line:

```loom
WREN
  (startled)
  Lightning?<flash: white, 200>

<sfx: distant_thunder>
```

## Stagecraft

| Directive | Does |
|---|---|
| `<sfx: bell_toll>` | play a sound effect |
| `<cue: lx_dawn>` | fire a lighting/tech cue |
| `<pause>` | hold for a beat |
| `<flash: white, 200>` | a 200 ms white flash |
| `<anchor: the_bell_rings>` | name this spot in the story (tests, analytics, show control) |

In a live event, unhandled stagecraft directives (`<cue:>`, `<prop:>`,
`<vibe:>`, …) flow to the show-control bridge — see
[Live game verbs](live-verbs.md).

## Story

| Directive | Does |
|---|---|
| `<set: x = 5>` | change a value ([Memory](memory.md)) |
| `<fire: bell_acknowledged>` | announce a named event other hooks can listen for |
| `<goal: Wren/find_keeper complete>` | push a character's goal forward |

`<fire:>` lets one part of the story send a signal that another part — a
hook, a listening character — reacts to, without direct wiring.

## Flow (syntactic forms)

These shape the story's structure rather than causing side effects:
`<if:>` / `<else if:>` / `<else>`, `<match:>`, `<each visit>`,
`<after:>` / `<otherwise>`, `<let:>`, `<shuffle:>`, `<cycle:>` — see
[Memory](memory.md) and [Variety](variety.md).

## Coroutines

| Directive | Does |
|---|---|
| `<spawn: HarborChorus>` | launch a SCENE/GENERATOR alongside the visible beat |
| `<run: investigate(Wren)>` | run a SCENE and *wait* for it to finish before continuing |
| `<cancel: HarborChorus>` | stop a spawned coroutine |

See [Background life](background-life.md).

## Block directives

Some directives wrap a chunk of story — everything indented beneath
belongs to them:

```loom
<broadcast: location(Plaza)>
  NARRATOR
    Welcome to The Stack. Tonight, you choose a side.
```

The rule is consistent everywhere in Loom: **indentation shows what
belongs to what.**

## Custom directives

Any directive name the runtime doesn't recognise can be defined by an
extension (a `.luau` file shipping `directive name(args) … end`). In the
browser and in live events, unknown directives degrade to logged events
instead of stopping the story — which is exactly what makes them useful
as show-control cues.
