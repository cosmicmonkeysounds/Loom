---
title: Choices & branching
section: Language
order: 11
keywords: choice, sticky, once, star, plus, divert, arrow, goto, END, entry, branch, nesting, hidden text, tunnel
---

## A choice

Put a `*` at the start of a line to offer the audience a choice:

```loom
WREN
  (quietly)
  It hasn't rung in three days.

* Ring the bell.
* Leave quietly.
```

Whatever is indented **under** a choice happens when they pick it:

```loom
* Ring the bell.
  The sound carries across the rocks.
* Leave quietly.
  You slip out before she can turn around.
```

## Going somewhere: diverts

A **divert**, written `->` ("go to"), moves between beats:

```loom
== opening

WREN
  It hasn't rung in three days.

* Ring the bell.
  -> ringing
* Leave quietly.
  -> END

== ringing

The sound carries across the rocks.

-> END
```

- `-> ringing` jumps to the beat named `ringing`.
- `-> END` ends the story.

Beats can be in any order, in any file — a divert finds its target by
name, project-wide.

## The entry point

When a project has several beats, name the starting one at the top with
`entry:`:

```loom
# The Lighthouse
entry: opening
```

If you don't write `entry:`, the first beat in the file is the start.

## Once vs. sticky choices

- `*` is a **once-only** choice — after the audience picks it, it's gone.
- `+` is a **sticky** choice — it stays available on later visits.

```loom
+ Ask about the bell.
  -> ask_bell
* Storm out.
  -> END
```

Use `+` for "ask another question"-style menu items, `*` for one-time
decisions.

## Hidden text on a choice

Sometimes the *button* should read one way and the *story* another. Wrap
the extra words in square brackets and they appear only after the choice
is taken:

```loom
* Leave quietly.[ But you wonder what you're walking away from.]
  -> END
```

The audience sees the button **Leave quietly.** After they click it, the
narration reads: *Leave quietly. But you wonder what you're walking away
from.*

## Nesting

Anything under a choice can include more choices, dialogue, action, and
diverts — as deep as you like:

```loom
* Confront her.
  WREN
    You shouldn't have come.
  * Apologise.
    -> makeup
  * Hold your ground.
    -> standoff
* Say nothing.
  -> END
```

## Tunnels — go and come back

A **tunnel** visits a beat and returns to where it left off. Call it
with parentheses, and end the tunnelled beat with `<-`:

```loom
(inspect_the_rope) ->

WREN
  Done looking?

== inspect_the_rope

The rope is frayed near the top.

<-
```

`<-` pops back to the line after the call. Use tunnels for reusable
asides — examining objects, side conversations — that shouldn't lose the
audience's place.
