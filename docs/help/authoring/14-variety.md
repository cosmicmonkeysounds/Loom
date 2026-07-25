---
title: Variety — lines that feel alive
section: Language
order: 14
keywords: cycle, shuffle, each visit, first then finally, after, otherwise, match, random, variation, repetition
---

A line the audience hears twice shouldn't read identically both times.

## Cycles and shuffles

`<cycle: …>` steps through options in order, one per visit.
`<shuffle: …>` picks one at random. Separate options with `|`:

```loom
FISHER
  <cycle: Quiet night. | Stars are out. | Tide's calm.>

DOCKHAND
  <shuffle: Storm's close. | Sky's wrong. | Time to tie down.>
```

The first time the fisher speaks he says "Quiet night."; next time,
"Stars are out."; and so on. The dockhand's line is random each time.

## First time, next time, finally

`<each visit>` lets a beat change as it's revisited:

```loom
<each visit>
  first
    WREN
      Who are you?
  then
    WREN
      You again.
  finally
    WREN
      I'm tired of your questions.
```

- `first` — plays on visit 1.
- `then` — plays on later visits.
- `finally` — plays once you've settled on the last variation.

## Before and after a turning point

`<after: condition>` swaps a beat's content once something becomes true.
Pair it with `<otherwise>` for the "before" version:

```loom
SELF
  <after: guest.captured>
    I've been in here since the old forums. Don't end up like me.
  <otherwise>
    A flickering figure mouths something you can't quite read.
```

Before `guest.captured` is true, the audience gets the flickering
figure. After — permanently — the warning.

## Choosing by value: `<match:>`

When a value has several possible states, `<match:>` picks the matching
arm (it falls through silently when nothing matches):

```loom
<match: weather>
  storm
    The rain comes sideways.
  fog
    You can't see the harbour wall.
  clear
    Gulls wheel over a flat sea.
```
