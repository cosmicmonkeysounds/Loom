---
title: Organising a project
section: Language
order: 20
keywords: project, folder, files, main.loom, comments, fences, disambiguation, slash, hash, naming, TODO
---

A short story fits in one file. A big one shouldn't.

## A project is a folder

Put your `.loom` files in a folder. One of them is `main.loom` — the
front door, where the title and `entry:` live:

```
the-lighthouse/
  main.loom          ← title, entry, shared characters
  beats/
    opening.loom
    ringing.loom
    endings.loom
  cast/
    wren.loom
```

## Names find each other automatically

You never write file paths in your story. A divert names its target and
Loom finds it *anywhere in the project*:

```loom
-> ringing
```

The same goes for characters: declare `Wren` in `cast/wren.loom` and
speak as `WREN` in any beat. Move files around freely — no divert
rewrites needed.

## When two beats share a name

Be specific with a `/` (folder) or `#` (spot inside a file):

```loom
-> Lighthouse/ringing
-> cast/wren#backstory
```

If an ambiguous name has a candidate in the *same file*, Loom prefers it
before erroring.

## Notes to yourself: comments

Anything after `//` is a comment — invisible to the audience. For longer
notes use `/* … */`:

```loom
// rough order: bell, beat, lantern up, line
WREN
  It hasn't rung in three days. // pick up the pace here

/*
  Blocking sketch from rehearsal 04-12:
  Wren crosses to the lantern on "three."
*/
```

## Notes for the production team: fences

A **fence** — a block wrapped in triple backticks — holds information
for the director, stage manager, or crew. The runtime ignores it, but it
stays visible in the prompt book:

````loom
WREN
  It hasn't rung in three days.
  ```blocking: cross to the lantern on "three"```

```note
This scene ran long at the table read. Consider cutting the lantern beat.
```
````

A ` ```todo ` fence shows up in the editor's project index — a built-in
task list. Comments are for *you*; fences are for the *team*.
