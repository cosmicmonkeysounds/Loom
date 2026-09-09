---
title: Welcome to Loom
section: Start Here
order: 1
keywords: welcome, introduction, overview, getting started, what is loom, tutorial, loom 4
---

**You do not need to know how to program.** If you can write a
conversation between two people, you can write in Loom.

Loom looks like a screenplay. Underneath, it is also a little machine
that *plays* your story — it remembers what the audience chose, tracks
how characters feel, branches when you want it to branch, and (when
you're ready) runs a live event with real people in a real room. You
write one file; it serves the reader, the director, the performers, and
the runtime all at once.

A **`.loom` file** is a plain text file. A **project** is a folder of
them (or a server project you edit right here).

## How this help is organised

- **Language** — the `.loom` syntax, one idea at a time, in learning
  order. Start at [Your first scene](first-scene.md) and read forward.
- **Live Shows** — everything for running a story with a real audience:
  rosters, locations, broadcasts, chat rooms, game verbs.
- **The Editor** — this app: Writing, Run, and Deploy modes, the story
  graph, rehearsing, and going live.
- **Reference** — the [cheat sheet](cheat-sheet.md) (every symbol on one
  page), [keyboard shortcuts](shortcuts.md), and
  [common mistakes](common-mistakes.md).

Use the **search box** above to jump straight to any symbol, keyword, or
concept — try searching for `sticky`, `divert`, or `broadcast`.

## The five-minute version

```loom
# The Lighthouse
start: The Bell Tower

== The Bell Tower

Wren (quietly): It hasn't rung in three days.

* Ring the bell.
  -> Ringing
* Leave quietly.
  -> END

== Ringing

The sound carries across the rocks.

-> END
```

- `# The Lighthouse` — the title.
- `start: The Bell Tower` — which beat starts the story.
- `== The Bell Tower` — a **beat**: a chunk of story. Any words make a
  name.
- `Wren (quietly): …` — a speaker, a hint to the performer, and the line.
- `* …` — a choice; what's indented under it happens if it's picked.
- `-> Ringing` — go to another beat; `-> END` ends the story.

Three habits carry you through the rest: **names are for humans** (any
words, capitals optional — `-> the bell tower` finds `== The Bell
Tower`), **instructions are plain verbs** at the start of a line
(`set coins = 10`, `if coins > 5:`, `cue lx_dawn` — no brackets), and
**everything that reacts is a `when`** (`when scanned by guest:`).

> Coming from Loom 3? Old files still play — `entry:`, ALL-CAPS cues,
> `<set:>` and friends all parse. Each article notes the old spelling
> once, where you might meet it.

Write a little, press Run (`⌘2`), add one idea. That loop — not this
guide — is how you'll actually learn Loom.
