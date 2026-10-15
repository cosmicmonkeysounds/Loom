---
title: The house map — drawing the house from a survey
section: Live Shows
order: 38
keywords: house map, map editor, floor plan, survey, measure, rooms, doors, yard, outdoor, tent, shed, stairs, floors, basement, upstairs, duck spot, spawn, terminal, location, reinstall, house.json, walkable, unreachable, undo
---

The reinstallation games and the wall terminals share one **house map**
(`house.json` — see [live verbs](33-live-verbs.md)): every room a
rectangle (or a rectilinear polygon) on a floor, doors in the walls
between them, stairs, the terminals where they hang, and the spots the
golden duck may hide. You draw it at **`/reinstall/map`** on a device set
up with the moderator passcode. Tick **Edit** to change it.

## Measuring

Pick an origin — the front door's outside threshold, at floor level —
and measure in metres: **x** grows east, **z** grows south (north is up
on the plan). For each room write down its west and north edges from
the origin and its width × depth. A tape and a friend calling numbers
out is plenty; 5 cm is close enough.

## Drawing

- **Floors** are the tabs along the top. **+ Floor** adds one above the
  top floor; click the current tab again to rename it, set its elevation
  (the floor surface: 0 for the ground floor, negative for a basement)
  and its ceiling height, or delete it with everything on it.
- **▭ Room** — drag a rectangle, or type its **W × D** and press **Add**
  (it lands east of the selected room, so a survey goes room by room).
  Select it to type its exact **x / z / W / D**, its label and the story
  **LOCATION** it is (the picker lists the story's LOCATIONs).
- **▒ Yard** — an outdoor rectangle: no roof, fences instead of walls.
  Draw an indoor room *inside* a yard (the tent, the shed) and the yard
  is cut around it on its own, with a flap door from the room into the
  yard. Move or delete the tent and the yard closes up behind it. A yard
  the tent splits in two stays one place: its pieces share the label and
  are joined edge to edge.
- **▯ Door** — click a wall. The door snaps onto it (90 cm wide) and
  joins the rooms on either side; a wall with a room on one side only is
  a door to the outside. Drag a door along its wall; **Open the whole
  edge** makes it as wide as the wall it is in.
- **▤ Stairs** — drag the stair's rectangle on its lower floor, then pick
  the lower and upper rooms and the side it rises toward. It needs 30 cm
  of floor beyond its foot and its head.
- **+ Terminal here** / **+ Duck spot here** on a selected room; drag
  them (and the spawn) into place, turn them with the round handle.

Doors and wall terminals follow a room you move or resize. Everything
snaps to the **snap** step, and room edges pull onto their neighbours'.
The wheel zooms; drag empty ground (or hold Space) to pan. **⌘Z** /
**⇧⌘Z** undo and redo any edit; **New blank house** starts over from one
floor and a yard.

## Checking

The panel under the inspector lists what is wrong as you draw — click an
entry to select what it names. **Problems** (rooms overlapping, a door
off its wall, a stair without room to land) block a save. **Warnings**
don't: a duck spot nobody can walk to from the spawn (the same route the
VR autopilot takes), a room naming no LOCATION in the story, a LOCATION
with no room. The **JSON** tab is the whole map as text, for anything the
drawing tools don't do (props, colours).

**🧊 3D** shows the draft as the games will build it (once it is valid):
drag to orbit, wheel to zoom.

**💾 Save** sends the map to the event. If another director saved since
you loaded it, nothing is saved and you are offered your edits as JSON
and a reload.
