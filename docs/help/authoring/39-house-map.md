---
title: The house map — drawing the house from a survey
section: Live Shows
order: 39
keywords: house map, house desk, map editor, Run → House, open in a new tab, open in browser, descent, level, voice link, microphone, mic, floor plan, survey, measure, rooms, doors, yard, outdoor, tent, shed, stairs, floors, basement, upstairs, duck spot, spawn, terminal, location, reinstall, house.json, walkable, unreachable, undo, speaker, speakers, house speakers, audio, audio.json, Audio tab, interface, MOTU, 828x, ADAT, expander, expect, layout, inputs, ducks as, reach, sidechain, subwoofer, outputs, routing, matrix, zone, cue, announcements, TV voice, tablets, terminals, announce, test, router, stagehand, placeholder, stop, light, lights, bulb, lights.json, Lights tab, Zigbee, Zigbee2MQTT, Z2M, pair, pairing, permit join, device, identify, colour, look, looks, cue, safety light, WLED, zone
---

The reinstallation games and the wall terminals share one **house map**
(`house.json` — see [live verbs](33-live-verbs.md)): every room a
rectangle (or a rectilinear polygon) on a floor, doors in the walls
between them, stairs, the terminals where they hang, and the spots the
golden duck may hide. You draw it in **Run → House → 🗺 Map**, with a
rehearsal running: your own run signs you in, so nothing asks for a
passcode. Tick **Edit** to change it.

Three ways lead there: **🗺 Edit the map** on the Run page's House map card,
*Open the house map* in the command palette (⌘⇧P), and the banner on a
`house*.json` open in Writing. With no run they tell you to start a
rehearsal. Your edits are kept while you visit another page or mode, until
the run ends; save before you leave for long.

**Open in a new tab ↗** beside the map opens the same editor on its own page
(`/reinstall/map`), for a second screen. The desktop app can't show the map's
questions, so there it opens in your browser instead. A device that goes
straight to `/reinstall/map` with no link is set up with the moderator
passcode, and asks for it again before its first save.

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
  them (and the spawn) into place, turn them with the round handle. A
  selected terminal sets its **screen**, whether it is a **room
  terminal**, and its **🎤 Voice link**: the tablet's microphone is heard
  in the games at that screen, and players are heard on its speaker,
  while a player is in that terminal's room in the game (wave 26: the
  same room, not just nearby). The link is on everywhere except the spawn
  room (the tent or the shed), where the headsets and the tent laptop
  are; the plan marks a terminal without it 🔇.
  A terminal's screen of **reinstall** is the tent laptop: the idle show
  between walks, and the reinstallation wizard and game for a marked
  pass; it belongs to no room (no *speaks*).
- **🔊 Speaker** — click where a house speaker hangs (or **+ Speaker
  here** on a selected room). It is drawn as a small cabinet facing the
  way it points, with a badge of its interface outputs (a red **—** when
  it has none) and a dashed ring that grows with its gain. Drag it, turn
  it with the handle or **R** / **⇧R**, nudge it with the arrows, **⌘D**
  copies it, **Delete** removes it. See *The house speakers* below.
- **💡 Light** — click where a house light hangs (or **+ Light here** on a
  selected room). It is drawn as a bulb tinted with the colour you last
  tested it in, a dashed green ring when it is a safety light, and its
  Zigbee2MQTT device under it (a red **⚠ no device** until you pick one).
  Drag it, nudge it with the arrows, **⌘D** copies it (without the
  device: one bulb is one device), **Delete** removes it. See *The house
  lights* below.

- **+ model** — pick a model, then click inside a room: a **wall
  panel**, a pillar, a cabinet, a shelf, a counter or a neon tube; a
  server rack, a mainframe, a PC tower, a CRT, a workstation, a video
  wall, a printer, a cable run, an error dialog or a security camera; a
  desk, a table, a filing cabinet, an office chair, a water cooler, a
  plastic plant or a recycle bin; and, under **Home**, **Studio** and
  **Strange**, a stove, a fridge, a broken microwave, a BBQ, a couch, a
  modular synth, a piano, a tea party, a door to nowhere and more. Each one lands at its own size in a
  clean white with its own neon; the plan draws it outlined in that
  neon with its name. Turn it with the round handle or **R** / **⇧R**
  (a wall panel stands along the way it faces, so turn it 90° to run it
  north–south), set its size in the inspector to stretch it (a long
  wall, a tall rack), and pick another **model**, **colour** or
  **neon** there (↺ puts the model's own back). A model is only how the
  games and the 3D preview draw it: it is solid as its box (or its
  circle, for the round ones), and an older game draws the plain box.
  Any box or cylinder can take a model.

  A box or a cylinder also has two descent fields in the inspector (a
  program reinstalled often enough starts to see things):

  - **Appears** — *Always*, or *From level 1…4*: only a program that far
    gone sees it, in the games only. It never collides (choosing a level
    clears **solid**) and no route or terminal knows it is there. The plan
    draws it dashed, with its level.
  - **Talks** — *by model* (the first talker in the event's `descent.json`
    that lists its model), a talker by name, or *never*. With no script on
    the event it is a text box: a talker's id, or `none`. A name the script
    doesn't have is a warning under Check.

Doors, wall terminals, speakers and lights follow a room you move or
resize (deleting a room deletes its speakers and lights; the confirm says
how many). Everything
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

- **Interface** — the audio interface on the computer that runs the
  speaker router (at the show, John's Desktop): its name (part of
  the name the computer shows: `828x` for the show's MOTU 828x; on Windows
  the router's machine file can name the ASIO device instead), how many inputs
  and outputs we use, its rate, and **the device reports** — how many it
  must report when its layout is as planned. The show uses 10 in and 12 out
  of the 828x on its own (no ADAT expander), numbered as the 828x numbers
  them: outputs 1–8 are Analog 1–8 (the line outs on the back), 9–10 Main
  L/R and 11–12 Phones L/R (each pair from a front headphone jack); inputs
  1–2 are the front Mic/Gtr, 3–10 Analog 1–8. S/PDIF and the ADAT
  channels are left unused. The device reports 32 in / 30 out with both
  optical ports set to ADAT, even with nothing plugged in; when mirroring
  Main and Phones, 96 kHz or an optical port on TOSLink changes that, every channel after the change
  is off, so `stagehand check` fails and the router logs it (it still
  plays). Clippy's wireless mic is mixed on the interface itself (CueMix);
  the TV's sound comes in on input 3 and the router sends it on (Routing,
  below), so in CueMix input 3 goes to no output.
- **Speakers** — every speaker, its room and its outputs. Select one on
  the plan for its inspector: name, id (renaming it renames it in every
  zone and cue), position and height, angle, gain in dB, its outputs as a
  grid (an output another speaker uses is marked) and its zones. The
  show's living room is Main L/R (outputs 9–10) plus a subwoofer on
  Analog 1 (output 1), a speaker of its own (`living-sub`) so its gain is
  its own; the three make the `living` zone. A gain change is heard at
  once, even on a long music track.
- **Outputs** — a label per output and the speakers on it.
- **Inputs** — a label per input and what it is: software (the router's
  computer, a virtual return), a mic, or a line from another device.
  **Ducks as** says whose voice the input carries: *none*, *trabolta*,
  *clippy* or a custom name. The router then listens to that input and
  turns the music down while it hears it (how far: the router's
  settings). With a role set, **ducks on** lists where the music goes
  down (zones, rooms, speakers, `everywhere`); left empty, it is the
  outputs the input's Routing row feeds (or everywhere with no route).
  The show's TV (input 3) ducks as *trabolta* everywhere, the sub
  included; Clippy's mic (input 1) ducks as *clippy* in the living room.
- **Routing** — the inputs × outputs matrix. Tap a cell to send that input
  to that output at 0 dB, tap again to cut it; the selected cell has a
  gain field. The show's TV row (input 3) sends Trabolta to every speaker
  but the sub: **a new speaker needs its cell ticked on that row** (the
  Fan Closet's, once it is placed), or he is not heard there.
- **Zones** — named groups of speakers a cue can name. `everywhere` is
  every speaker and needs no zone. **◉** keeps a zone lit on the plan.
- **Story sounds** — every `sound` in the story, each with its targets
  (zones, rooms, LOCATIONs, single speakers) and a gain. A line's own
  `in` / `rooms:` wins over these targets; a sound with neither follows the
  beat's setting (see [where a sound plays](19-directives.md)). `announce_chime` has no row of
  its own: it rings with the announcements.
- **Announcements and the TV voice** — the speakers the house
  announcements play on (and whether a chime goes first), and the
  speakers the TV's voice should also reach (a note: the TV row of
  Routing is what sends it).
- **Tablets that also say them** — every terminal spot on the map, by
  room. Tick a spot and the tablet hanging there also says each house
  announcement in its own voice. It is an option, off for every room until
  you tick it. Each row says whether the house speakers already reach that
  room (*the tablet would echo them*) or none do (*the tablet would be the
  only voice*). A tablet set to *Always* or *Never* on its own ⚙ ignores
  this list; one left on *House setting* follows it. The list is part of
  `audio.json`, so ticking a spot never changes the map.

Hovering a speaker, a zone or a cue lights the speakers it reaches.

**🔈 Test** on a speaker or an output makes the speaker router play a short
tone there and say its name — the walk round the house with the Audio tab
open. A speaker is tested only once it is saved. The header's badge says
whether the speaker router is listening (*router online*,
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

**👣 Footsteps** — a program walking in the games is heard in the real
house, on the speakers near where it walks and, muffled, through the walls
and floors. **On**, the **reach** in metres a speaker carries a program, and
the **level** in dB on top of the mix's Footsteps strip. Selecting a speaker
gives a **👣 Test** beside 🔈 Test: a program's steps on that speaker alone
for a few seconds (save the speakers first). The router makes the steps
itself. It needs the `audio` job restarted on a new release, nothing else.

The speaker router (stagehand's `audio` job, at the show on John's Desktop;
the MacBook is only the fallback) plays every story sound, every house
announcement and the music (see [music all night](19-directives.md)) (the show's
`trapped.house.yaml` turns both on). An announcement reaches it as MQTT
`show/announce` from stagehand's `show` job (on John's Desktop), so both
jobs must be up and on the same broker. Until each real sound file is in, it plays a labelled placeholder:
a short tone, then the sound's name spoken (`stagehand sounds
placeholders`); a real file always wins, and `stagehand check` lists the
placeholders still there. **■ Stop house sounds** on Run (or a host's
phone) fades every story sound at once; see [Run mode](43-run-mode.md).
Setting it up: `scripts/house-desktop/README.md` (the Desktop),
`scripts/house-macbook/audio.md` (the MacBook fallback), `docs/trapped/room-audio.md`
§11–§12 and the `audio` module in `stagehand/README.md`.

## The house lights

The lights the story drives live in their own project file,
**`lights.json`**, beside `audio.json` — never in the map, so placing a
bulb mid-show never moves the map's version, and the tent and the shed
share them. The **lights module** (stagehand's `lights` job, at the show on John's
Desktop)
plays them over Zigbee2MQTT (and WLED): a story `cue heart_wake` plays the
look named `heart_wake`.

In *Trapped in the Internet*, `lights.json` already holds every house
bulb and the living room's WLED strip (`wled/living`), each placed in its
room under its Zigbee2MQTT name (`living_1`, `kitchen_2`, `hall_main`,
`server_room_rgb`, …), the halls and bathrooms as safety lights, and every
`lights_*` and `heart_*` look. There are no Zigbee groups or scenes and no
WLED presets: on site you only pair each bulb and give it that name
(steps 1–2 below); move a light only if it hangs somewhere else.

**Getting a bulb working on site** (the **💡 Lights** tab's first section
ticks these off as you go):

1. Check the tab's badge says **💡 module online**. If it says *no lights
   module yet* or *last seen …*, start it on the computer that runs it (at the show the Desktop:
   `.\scripts\house-desktop\start-stagehand.ps1`; on a Mac `stagehand
   launchd install --job lights`; then `stagehand check --only lights`):
   pairing and tests go through it.
2. **📡 Pair new device** opens Zigbee joining for two minutes (the
   countdown shows; **Stop pairing** closes it). Reset the bulb — most
   switch off and on 5–6 times, a second each — and within a minute it
   appears under **Devices** marked **★ new**. (You can rename it in the
   Zigbee2MQTT frontend first; the list follows the new name.)
3. Tick **Edit**, then **Place it** on the ★ new row and click where it
   hangs — or place a 💡 Light and pick the device in the inspector. A new
   light hangs **2.1 m above its floor** in the house frame (the basement
   floor is at −2.7, so a basement ceiling bulb is at y −0.6); the
   inspector shows the floor's height band and a button to put it back.
4. In the inspector: its **device** (the list puts the bulbs nobody has
   placed first; *type a name…* for one the module hasn't reported, or a
   WLED topic like `wled/living`, which makes it a WLED strip), its
   **kind**, what it **can do** (colour, white temperature, dim — filled
   in from the device), **safety light** for any light people need to see
   by (never off, never below its floor: 40 of 254 at least), and its
   zones.
5. **💾 Save**, then **💡 Identify** (the bulb pulses) and the colour
   swatches (red, amber, white, cyan, blue, violet, Dim). A test needs the
   light saved with that device: the module only knows saved lights. If
   the test says the light *would change nothing*, its caps can't do that
   colour — fix **can do**, or try another swatch.

**Looks.** (Looks can also be designed, with a live preview and
templates, in Run → House → [the Cue designer](50-cue-designer.md); both
edit the same `lights.json`.) The **Looks** section lists every look; the story's `cue`
names that have no look yet appear as **+ name** buttons, and a look no
cue plays says so. Open a look to set:

- **plays on** — lights, zones, rooms or the story's LOCATIONs (`The
  Server Room` reaches every light in a room that is that LOCATION);
- **steps** — each step at a time in ms from the start: on / off,
  brightness (0–254), a colour or a white temperature (mireds), an
  effect, a fade in seconds. Zigbee drops commands sent too fast, so a
  step is at least **150 ms** after the one before on the same light,
  **400 ms** when it changes the colour; a step too early turns red and
  says how early it may come. **+ Step** adds one far enough along, a
  swell back the other way;
- **ends** — *once*, *a few times*, *loop until the next look* or *once,
  then give the light back* (the light returns to what it showed before:
  a running loop restarts). A loop's or repeat's **period** must leave the
  same gap between the last step and the first again (and on Zigbee at
  least 1.5 s, or it reads as flicker); choosing the mode sets a safe
  period for you, and a period typed too short says the least it can be.

Each look shows the checker's problems inline; **▶ Test look** plays the
saved look now. The **boot look** plays when the module starts and after a
story reset. A look may never turn a safety light off or below its floor
(the save is refused), and its name is the story's cue name (lower-case
letters, digits and `_`; never a `screens_` / `terminals_` / `tv_` /
`tablet_` / `room_` cue, which are the screens', or a `music_` cue, which
is the soundtrack's).

**Presence** (a program pulses the light it walks under). In the
reinstallation games, a program that walks under a light makes that
light pulse in the real house: the server sees who stands within the
**radius** of a light in the same room (**1.6 m** by default), and the
lights module plays the bulb's own firmware effect while they stay and
for **4 s** after they leave (a Hue *breathe* is re-sent every 12 s). The
**Presence** section edits it:

- **Pulse the lights the programs walk under** — on unless you untick it;
- **which lights** — lights, zones, rooms or LOCATIONs (everywhere when
  left alone; removing every chip pulses nothing). A **safety light never
  pulses**, whatever the list says: a breathe goes dark, and its floor
  can't hold;
- **how near** — the radius in metres, 0.5 to 5;
- **effect** — *breathe* (a slow fade down and up), *blink* or *okay*. A
  WLED strip plays its own breathe (or blink).

A pulse never stops a look, and a bulb a look turned off stays dark. The
games draw every light the way the real house shows it, and pulse it
there too.

To **test** every speaker, output, story sound, light and look one row
at a time, and to build house cues that play sounds and lights together,
use Run → House ([the house desk](47-house-desk.md)).

**Saving.** 💾 saves the map, then the speakers, then the lights, each
when it fits the map the server holds (a light standing in a room only
your draft has saves after the map). Another director's save in between
answers *changed since you loaded them* and offers a reload; a save
elsewhere while you hold no light edits just arrives. **Save to project**
(on the tab, and on the toolbar's project bar after the map) writes
`lights.json` into the project for the next launch and every co-writer;
**Download JSON** gives you the file. Every lights problem is in the
problem list with a 💡: click one to select the light or open the tab.

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
