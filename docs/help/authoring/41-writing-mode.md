---
title: Writing mode
section: The Editor
order: 41
keywords: writing, text editor, split, follow, rename, F2, go to definition, references, completion, hover, diagnostics, lint, undo, journal, outline, todo
---

Writing (`⌘1`) is the whole authoring surface. The center stage is a
resizable **text editor ⇄ story graph split** — screenplay and structure
visible (and editable) at the same time. `⌘\` toggles the graph pane;
either pane snaps closed at the divider.

## The text editor knows Loom

- **Diagnostics** — parse errors and project-wide problems (unfilled
  slots, unresolved trait args, beat conflicts) underline as you type.
- **Completion** — divert targets after `->` (including `self.` and
  `Owner.` owned beats), directive names inside `<…>` (the long form
  for mid-line effects and custom verbs), traits after `is`.
- **Hover** — directive signatures, character summaries, a beat's cast
  and setting, trait params.
- **Go to definition** — `⌘Click` or `F12` on any divert, speaker, or
  cue jumps to its declaration, cross-file.
- **Find references** — `⇧F12` lists every use in the References panel.
- **Rename** — `F2` renames the beat at the cursor *everywhere*:
  declaration, every divert, `start:` — across all files. Beat names
  are plain words (`== The Front Gate`), so the rename keeps their
  spelling consistent even though `-> the front gate` would still
  resolve.
- **Right-click** — definition / references / rename / reveal in story
  graph, plus clipboard basics. `⇧Right-click` keeps the browser menu.

The highlighter and the index understand the whole surface — a
one-liner `Ivo: You came back.` is dialogue just like an ALL-CAPS cue,
and a lowercase verb at the start of a line is an instruction:

```loom
== The Front Gate
  setting: Orchard Gate

Ivo: You came back.
* "Where is she?"
  set Ivo.trusts.Player += 5
  -> Ask About Mara
```

## The two panes track each other

- Opening a beat on the canvas also lines the text editor up on its
  declaration (without stealing your keyboard focus).
- The **follow** toolbar toggle selects and centers, on the canvas,
  whatever beat or declaration encloses your text cursor as you move.

## The properties tray

The right tray (`⌘⌥B`) follows your selection: a beat shows its
editable contract (cast/setting) and In/Out links; a connection shows
its route, choice text, guard, and a **Rewire to** picker; a file shows
its beats and declarations. With nothing selected on the canvas it
follows the text cursor.

## Undo for structural edits

Canvas and tray edits (connect, rewire, create, rename, delete, block
edits) journal as labelled multi-file entries — **`⌘Z` / `⌘⇧Z` outside
the text editor** undo/redo them safely (a file you've since edited by
hand is never clobbered). Inside the text editor, CodeMirror's own
undo history applies as usual.

## Project navigation

- `⌘P` — go to file; `⌘⇧O` / `@` — symbols in file; `#` — symbols
  project-wide.
- The rail's **Story Bin** tab lists every beat and entity in the
  project, filterable — click to select on canvas, double-click to jump
  to source.
- ` ```todo ` fences surface in the project index as a task list.
