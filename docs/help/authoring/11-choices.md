---
title: Choices & branching
section: Language
order: 11
keywords: choice, sticky, once, star, plus, guard, condition, if, tag, needs, divert, arrow, goto, END, entry, branch, nesting, hidden text, tunnel, start, return, parameters, with
---

## A choice

Put a `*` at the start of a line to offer the audience a choice:

```loom
Wren (quietly): It hasn't rung in three days.

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
== The Bell Tower

Wren: It hasn't rung in three days.

* Ring the bell.
  -> Ringing
* Leave quietly.
  -> END

== Ringing

The sound carries across the rocks.

-> END
```

- `-> Ringing` jumps to the beat named `Ringing`.
- `-> END` ends the story.

Beats can be in any order, in any file — a divert finds its target by
name, project-wide. Matching is forgiving: `-> the bell tower` reaches
`== The Bell Tower`.

## The starting beat

When a project has several beats, name the starting one at the top with
`start:`:

```loom
# The Lighthouse
start: The Bell Tower
```

If you don't write `start:`, the first beat in the file is the start.
(`entry:` is the Loom 3 spelling and still works.)

## Once vs. sticky choices

- `*` is a **once-only** choice — after the audience picks it, it's gone.
- `+` is a **sticky** choice — it stays available on later visits.

```loom
+ Ask about the bell.
  -> Ask About The Bell
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

## Options that need something

Write `(if <condition>)` right after the `*` or `+` and the option is
offered only while the condition holds:

```loom
Trabolta: Why should I listen to you?

+ (if program.trust >= 20) ⟦TRUSTED⟧ You trust me more than anyone here.
  -> Trusted
+ (if program.has_proof == true) ⟦PROOF⟧ I have Sandy's file.
  -> Proof
+ Who are you?
  -> Who
```

- The condition is read **when the menu appears**, with the same names an
  `if` would see (`program.…`, `Night.…`, `self.…`). An option whose
  condition is false simply isn't there; the others keep their order.
- If **no** option is left, there is no menu at all — the story carries on
  with the line after it.
- The parenthesis must close on the same line, and parentheses inside the
  condition nest. Anything else (`* (whispering) Hello.`) is ordinary text.
- A condition that doesn't parse is flagged while you write (`L1221`) and
  the option is never offered.
- Tag an option with `⟦WORD⟧` (the white square brackets), never `[WORD]`:
  in a choice, `[…]` is hidden text (above).
- In a live event a menu is offered again each time its beat plays, so a
  "once only" option is a `+` with a flag you set yourself
  (`set program.asked_why = true`, and `(if program.asked_why != true)` on
  the option).
- Game-engine banks don't run the condition yet: the option banks always
  offered, and the compiler says so (`choiceGuardIgnored`).

## Nesting

Anything under a choice can include more choices, dialogue, action, and
diverts — as deep as you like:

```loom
* Confront her.
  Wren: You shouldn't have come.
  * Apologise.
    -> Making Up
  * Hold your ground.
    -> The Standoff
* Say nothing.
  -> END
```

## Tunnels — go and come back

A **tunnel** visits a beat and returns to where it left off. Call it
with parentheses, and end the tunnelled beat with `return`:

```loom
(Inspect The Rope) ->

Wren: Done looking?

== Inspect The Rope

The rope is frayed near the top.

return
```

`return` pops back to the line after the call (`<-` means the same
thing). Use tunnels for reusable asides — examining objects, side
conversations — that shouldn't lose the audience's place.

## Passing something along

A beat can take parameters — `== Ask About(topic)` — and a divert can
fill them with `with`:

```loom
-> Ask About with topic: the bell
```

Inside the beat, `{topic}` reads *the bell*. See
[Owned beats](owned-beats.md) for handing whole blocks of content into
a beat.
