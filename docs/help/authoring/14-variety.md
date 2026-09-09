---
title: Variety — lines that feel alive
section: Language
order: 14
keywords: cycle, shuffle, each visit, first then finally, after, otherwise, match, random, variation, repetition
---

A line the audience hears twice shouldn't read identically both times.

## Cycles and shuffles

`cycle` steps through options in order, one per visit. `shuffle` picks
one at random. Separate options with `|`:

```loom
cycle Quiet night. | Stars are out. | Tide's calm.

shuffle Storm's close. | Sky's wrong. | Time to tie down.
```

The first time the audience passes this spot they read "Quiet night.";
next time, "Stars are out."; and so on. The shuffled line is random
each time.

To vary the words *inside* a spoken line, use the mid-line form:

```loom
Fisher: <cycle: Quiet night. | Stars are out. | Tide's calm.>
Dockhand: <shuffle: Storm's close. | Sky's wrong. | Time to tie down.>
```

(That angle-bracket spelling is also how Loom 3 wrote every cycle — see
[Instructions](directives.md) for the long form.)

## First time, next time, finally

`each visit:` lets a beat change as it's revisited:

```loom
each visit:
  first:
    Wren: Who are you?
  then:
    Wren: You again.
  finally:
    Wren: I'm tired of your questions.
```

- `first:` — plays on visit 1.
- `then:` — plays on later visits.
- `finally:` — plays once you've settled on the last variation.

## Before and after a turning point

`after <condition>:` swaps a beat's content once something becomes
true. Pair it with `otherwise:` for the "before" version:

```loom
after Mara.knows.the_truth:
  Mara (quietly): I've known since the orchard. I was waiting for you to say it.
otherwise:
  Mara: I don't know what you mean.
```

Before `Mara.knows.the_truth` is true, the audience gets the
deflection. After — permanently — the confession.

## Choosing by value: `match`

When a value has several possible states, `match` picks the matching
arm (it falls through silently when nothing matches):

```loom
match weather:
  storm:
    The rain comes sideways.
  fog:
    You can't see the harbour wall.
  clear:
    Gulls wheel over a flat sea.
```

Arms can be names too — `match guest.group:` with `The Gardeners:` and
`The Collectors:` arms lets one beat speak differently to each side.
