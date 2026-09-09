---
title: Organising a project
section: Language
order: 20
keywords: project, folder, files, main.loom, comments, fences, disambiguation, slash, hash, naming, TODO, start, GROUP, LOCATION
---

A short story fits in one file. A big one shouldn't.

## A project is a folder

Put your `.loom` files in a folder. One of them is `main.loom` — the
front door, where the title, `start:`, and the shared declarations live:

```
the-glass-orchard/
  main.loom          ← title, start, GROUPs, LOCATIONs, the guest ROLE
  beats/
    arrival.loom
    glasshouse.loom
    cellar.loom
  cast/
    hosts.loom       ← the characters and their hooks
    props.loom       ← scannable objects, one line each
  rooms.loom         ← extra chat rooms for the live show
```

```loom
# The Glass Orchard
start: The Front Gate

GROUP The Gardeners
  ethos: tend

LOCATION The Cellar
  label: Under the Orchard
  capacity: 8
```

(`entry:` is the Loom 3 spelling of `start:`, and `FACTION` of `GROUP`;
both still read.)

## Names find each other automatically

You never write file paths in your story. A divert names its target and
Loom finds it *anywhere in the project*:

```loom
-> The Long Table
```

The same goes for characters: declare `Ivo Marsh` in `cast/hosts.loom`
and speak as `Ivo Marsh:` in any beat. Matching ignores capitals and
treats spaces, `_` and `-` alike, so `-> the long table` works too. Move
files around freely — no divert rewrites needed.

## When two beats share a name

Be specific with a `/` (folder) or `#` (spot inside a file):

```loom
-> cellar/The Long Table
-> cast/hosts#backstory
```

If an ambiguous name has a candidate in the *same file*, Loom prefers it
before erroring. Since `Ivo Marsh` and `ivo-marsh` are the same name to
Loom, don't declare both — pick one spelling. And keep `.` `/` `#` and
the words ` with ` / ` as ` out of beat names: a divert reads them as
qualifiers.

## Notes to yourself: comments

Anything after `//` is a comment — invisible to the audience. For longer
notes use `/* … */`:

```loom
// rough order: bell, beat, lantern up, line
Wren: It hasn't rung in three days. // pick up the pace here

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
Wren:
  It hasn't rung in three days.
  ```blocking: cross to the lantern on "three"```

```note
This scene ran long at the table read. Consider cutting the lantern beat.
```
````

A ` ```todo ` fence shows up in the editor's project index — a built-in
task list. Comments are for *you*; fences are for the *team*.
