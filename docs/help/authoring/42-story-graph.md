---
title: The story graph
section: The Editor
order: 42
keywords: story graph, node editor, canvas, map, drill in, word blocks, edges, ghost, rewire, connect, filter, arrange, minimap, containers
---

The story-graph pane is a **node editor over the whole project**, 1:1
with the language — every beat, divert, choice, and hook in every file,
drawn as one map. Everything you do on it writes real `.loom` source.

## Reading the map

- **Beats** are cards, grouped inside **file containers** (collapse a
  file with its header chevron — edges re-route to the folded node).
- **Edges** are diverts (solid), choices (labelled with their button
  text), tunnels, and `on <event>` hook routings from character pills.
- **▶** marks the entry beat; **END** is the terminal; a red **ghost
  node** is a divert whose target doesn't exist yet — double-click it to
  create the missing beat.
- Toggle the **entity overlay** to see cast/setting/membership
  relationships too.
- Guard context (`<if:>` arms, match arms) rides the edge labels.

## Drilling into a beat

Double-click a beat (or press Enter) to see its **body as a flow**:
dialogue cards, choice fan-outs that re-merge after the menu,
conditional branch heads with labelled arms, divert exit pills that
double-click through to their target. The breadcrumb backs out (Esc).

## Word blocks — the whole story on the canvas

Expand any beat card (▸ chevron) to see its full body as typed blocks —
prose, dialogue, directives, choices, arms, diverts. Blocks are
editable source:

- **Double-click a block** — edit its literal source lines in place
  (Enter commits, `⇧Enter` newline, Esc cancels).
- **Right-click a block** — insert a line above/below, delete it.
- **Card menu** — add lines or choices; **file/pane menu** — create
  beats and CHARACTER/LOCATION/FACTION declarations.

## Authoring by wiring

- **Drag from one beat to another** — appends a divert.
- **Drag an edge end onto a different beat** — retargets that divert in
  source.
- **F2** renames the selected beat project-wide; **Delete** removes it.
- The bottom **BeatStrip** shows the selected beat's body as linear
  clips — drag to reorder, right-click to delete, type to append.

## Finding things

- The toolbar **filter** dims everything that doesn't match as you type
  (beat, owner, entity, or file); Enter jumps to the first hit.
- **Arrow keys** walk selection to the nearest node; Enter drills in.
- The **MiniMap** pans and zooms; selecting a node highlights its
  connections and dims the rest.

## During a run

The same canvas mounts read-only in Run mode's Story tab and **lights
up live**: visit badges, a pulse on the current beat, amber heat on the
edges the run actually took, and occupant chips showing which guests
are standing in which beat. Right-click a beat there to **fire it**.
