---
title: The house map — drawing the house from a survey
section: Live Shows
order: 39
keywords: house map, map editor, floor plan, survey, measure, rooms, doors, yard, outdoor, tent, shed, stairs, floors, basement, upstairs, duck spot, spawn, terminal, location, reinstall, house.json, walkable, unreachable, undo, speaker, speakers, house speakers, audio, audio.json, Audio tab, interface, MOTU, 828x, ADAT, expander, expect, layout, inputs, outputs, routing, matrix, zone, cue, announcements, TV voice, tablets, terminals, announce, test, router, stagehand, placeholder, stop
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
  **LOCATION** it is (the picker lists the story's LOCATIONs). A typed
  field takes effect when you press **Enter** or leave it (Esc puts it
  back); the spinner arrows apply at once.
- **▒ Yard** — an outdoor rectangle: no roof, fences instead of walls.
  Draw an indoor room *inside* a yard (the tent, the shed) and the yard
  is cut around it on its own, with a flap door from the room into the
  yard (a notice says so — move or delete it if the way in is elsewhere).
  House rooms drawn against each other get no flaps: put their doors in
  yourself. A part of the yard the cut shuts off from everything else gets
  a flap too, so nobody is walled out. Move or delete the tent and the
  yard closes up behind it. A yard the tent splits in two stays one place:
  its pieces share the label and are joined edge to edge, so it is
  selected, renamed and deleted whole (it moves with the rooms in it, or
  **Fill the yard**). Two yards on one floor need different names.
- **▯ Door** — click a wall. The door snaps onto it (90 cm wide) and
  joins the rooms on either side; a wall with a room on one side only is
  a door to the outside. Drag a door along its wall; **Open the whole
  edge** makes it as wide as the wall it is in.
- **▤ Stairs** — drag the stair's rectangle on its lower floor, then pick
  the lower and upper rooms and the side it rises toward. It needs 30 cm
  of floor beyond its foot and its head.
- **+ Terminal here** / **+ Duck spot here** on a selected room; drag
  them (and the spawn) into place, turn them with the round handle.
- **🔊 Speaker** — click where a house speaker hangs (or **+ Speaker
  here** on a selected room). It is drawn as a small cabinet facing the
  way it points, with a badge of its interface outputs (a red **—** when
  it has none) and a dashed ring that grows with its gain. Drag it, turn
  it with the handle or **R** / **⇧R**, nudge it with the arrows, **⌘D**
  copies it, **Delete** removes it. See *The house speakers* below.

Doors, wall terminals and speakers follow a room you move or resize
(deleting a room deletes its speakers; the confirm says how many). Everything
snaps to the **snap** step, and room edges pull onto their neighbours'.
The wheel zooms; drag empty ground (or hold Space) to pan. **⌘Z** /
**⇧⌘Z** undo and redo any edit; **New blank house** starts over from one
floor and a yard.

## Checking

The panel under the inspector lists what is wrong as you draw — click an
entry to select what it names. **Problems** (rooms overlapping, a door
off its wall, a stair without room to land) block a save. **Warnings**
don't: a duck spot nobody can walk to from the spawn (the same route the
VR autopilot takes), a duck spot close enough to a wall to be picked up
from the room behind it (move it ≥ ~1.2 m from that wall), a room or yard
no door leads into yet, a room naming no LOCATION in the story, a
LOCATION with no room. The speakers' problems and warnings are listed
too, marked 🔊 (an output two speakers share, a speaker with no output, a
story sound that reaches no speaker): click one to select that speaker or
open the Audio tab. The **JSON** tab is the whole map as text, for
anything the drawing tools don't do (props, colours). It holds the map
only, not the speakers.

**🧊 3D** shows the draft as the games will build it (once it is valid):
drag to orbit, wheel to zoom.

**💾 Save** sends the map to the event, then the speakers when they
changed. If the map changed since you loaded it (a save or a variant
switch), nothing is saved and you are offered your edits as JSON and a
reload. **⌘Z** steps back through map and speaker edits alike, in the
order you made them.

## The house speakers

The house speakers are not part of the map. They live in the project's
own file, **`audio.json`** — never `house.json` or a `house.<word>.json`,
which is read as a map variant — so moving a speaker or re-patching the
interface mid-show never changes the map's version (which remaps every
game), and the tent and shed maps share one set of speakers. A speaker names the map room it stands in (set from
where you put it) and its position in that room.

The **Audio** tab is the rest of the file, top to bottom:

- **Interface** — the audio interface on the house Mac: its name (part of
  the name the Mac shows: `828x` for the show's MOTU 828x), how many inputs
  and outputs we use, its rate, and **the device reports** — how many it
  must report when its layout is as planned. The show uses 24 in and 22 out
  of the 828x + an 8-channel ADAT expander, numbered as the 828x numbers
  them: outputs 1–8 are Analog 1–8, 9–10 the Main outs, **15–22 the
  expander** (Optical A); inputs 1–2 are the front Mic/Gtr, 3–10 Analog
  1–8, **17–24 the expander**. Outputs 11–14 (Phones, S/PDIF) are left
  unlabelled. The device reports 32 in / 30 out; when mirroring, 96 kHz or
  an optical port on TOSLink changes that, every channel after the change
  is off, so `stagehand check` fails and the router logs it (it still
  plays). Live mics are mixed on the interface itself (CueMix FX).
- **Speakers** — every speaker, its room and its outputs. Select one on
  the plan for its inspector: name, id (renaming it renames it in every
  zone and cue), position and height, angle, gain in dB, its outputs as a
  grid (an output another speaker uses is marked) and its zones.
- **Outputs** — a label per output and the speakers on it.
- **Inputs** — a label per input and what it is: software (the house
  Mac, a virtual return), a mic, or a line from another device.
- **Routing** — the inputs × outputs matrix. Tap a cell to send that input
  to that output at 0 dB, tap again to cut it; the selected cell has a
  gain field.
- **Zones** — named groups of speakers a cue can name. `everywhere` is
  every speaker and needs no zone. **◉** keeps a zone lit on the plan.
- **Story sounds** — every `sound` in the story, each with its targets
  (zones, rooms, LOCATIONs, single speakers) and a gain. A line's own
  `in` / `rooms:` wins over these targets; a sound with neither follows the
  beat's setting (see [where a sound plays](19-directives.md)). `announce_chime` has no row of
  its own: it rings with the announcements.
- **Announcements and the TV voice** — the speakers the house
  announcements play on (and whether a chime goes first), and the
  speakers the TV's voice should also reach (patched on the interface's
  own mixer for now).
- **Tablets that also say them** — every terminal spot on the map, by
  room. Tick a spot and the tablet hanging there also says each house
  announcement in its own voice. It is an option, off for every room until
  you tick it. Each row says whether the house speakers already reach that
  room (*the tablet would echo them*) or none do (*the tablet would be the
  only voice*). A tablet set to *Always* or *Never* on its own ⚙ ignores
  this list; one left on *House setting* follows it. The list is part of
  `audio.json`, so ticking a spot never changes the map.

Hovering a speaker, a zone or a cue lights the speakers it reaches.

**🔈 Test** on a speaker or an output makes the house Mac play a short
tone there and say its name — the walk round the house with the Audio tab
open. A speaker is tested only once it is saved. The header's badge says
whether the house Mac's speaker router is listening (*router online*,
*router last seen …*); a Test sent with nobody listening says it was only
queued. **Recent tests** lists the last minute's.

**💾 Save speakers** sends the file to the event, and the router follows
at once. When a speaker stands in a room only your unsaved map has, the
button reads **💾 Save map + speakers** and saves the map first. If the
speakers changed since you loaded them, nothing is saved: **Reload the
speakers** and redo your edits. **Save to project** (once they are saved)
writes `audio.json` into the project for the next launch and every
co-writer; **Download JSON** gives you the file. With no file yet the tab starts from a blank
16 in / 16 out interface.

The house Mac's speaker router plays every story sound and every house
announcement (the show's `trapped.house.yaml` turns both on; there is no
QLab). Until each real sound file is in, it plays a labelled placeholder:
a short tone, then the sound's name spoken (`stagehand sounds
placeholders`); a real file always wins, and `stagehand check` lists the
placeholders still there. **■ Stop house sounds** on Run (or a host's
phone) fades every story sound at once; see [Run mode](43-run-mode.md).
Setting it up: `scripts/house-mac/audio.md`, `docs/trapped/room-audio.md`
§11–§12 and the `audio` module in `stagehand/README.md`.

## Tent or shed, and keeping the map

The toolbar's **Map:** buttons are the whole-map variants the event can
play — for *Trapped in the Internet*, **Tent** (`house.json`) and
**Shed** (`house.shed.json`, the rain night). The one marked **● live**
is what every program and terminal plays now. Press the other to switch,
mid-show too: programs keep playing from where they stand, and a duck
whose spot isn't on the new map is dealt a new one. Anyone standing where
the new map has no floor — inside the shed when you switch back to the
tent, where the shed is a solid box — is put back at the start. The choice
sticks: it survives a restart and **End → relaunch** (the next launch
starts on the variant the last one played). The page asks first when programs are in the
simulation, when a saved edit would be dropped, or when you have unsaved
edits, then shows the new map. When this event's map has saved edits that
aren't in the project, it first offers to **Save to project** for you (OK
saves, then switches; Cancel goes on to the warning that they'll be
dropped, where you can still back out). A director can make the same
switch from the editor, with no passcode device: the Run page's **House
map** card (it asks first too, but has no Save to project — do that here).

**The labels come from the maps.** A map's own `"variant"` field names
its button (the show's maps say `"variant": "Tent"` and `"variant":
"Shed"`), so renaming a map in the JSON tab never changes it. A
`house.<word>.json` file's label must say its word, so a shed copied
from the tent map with `"variant": "Tent"` left in still reads **Shed**.
Without one, a variant is named after its file (`house.shed.json` → **Shed**);
the default `house.json` after the one word in its map's `name` that the
others' names lack ("…the Internet in the **tent**" → **Tent**), else
**Main**.

A 💾 save belongs to this event only. **Save to project** writes the map
into the project as the live variant's file (your unsaved edits are saved
first), so the next launch and every co-writer get it. **Download JSON**
gives you the file to commit.
