---
title: Welcome to Loom
section: Start Here
order: 1
keywords: welcome, introduction, overview, getting started, what is loom, tutorial
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
entry: opening

== opening

WREN
  (quietly)
  It hasn't rung in three days.

* Ring the bell.
  -> ringing
* Leave quietly.
  -> END

== ringing

The sound carries across the rocks.

-> END
```

- `# The Lighthouse` — the title.
- `entry: opening` — which beat starts the story.
- `== opening` — a **beat**: a chunk of story.
- `WREN` + indented line — a speaker and their dialogue.
- `* …` — a choice; what's indented under it happens if it's picked.
- `-> name` — go to another beat; `-> END` ends the story.

Write a little, press Run (`⌘2`), add one idea. That loop — not this
guide — is how you'll actually learn Loom.
