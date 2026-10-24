# loom-reinstall — the reinstallation game (web) + the house map

A program the Antivirus dragged into **The Internet** is *reinstalled* by
proving it can follow instructions: it walks a **virtual copy of the
house** and finds **Gerald, the golden duck**. This app is the web half of
that game (the VR half is the Godot project in `../vr/`), plus the
**house map** viewer / editor that every spatial piece is placed with
(rooms, doors, stairs, props, terminals, duck spots, speakers, lights).

On the night this app does not run as its own page in the tent: the tent
laptop is a wall terminal at `view=reinstall` (`terminal/src/reinstall/`),
which mounts this app's flow (`src/flow.tsx`) and game in a shadow root.
The standalone page at `/reinstall/` stays for a spare tablet, a
headset-only controller and the map editor.
The design contract is [`docs/loom-reinstall.md`](../../docs/loom-reinstall.md)
(§3 is this app).

- A device here is a **trusted device**, like a wall terminal: set up once
  with the event's moderator passcode, which it trades for a moderator
  token (`/api/mod/login`). The passcode is never stored.
- A scanned pass is only a guest id. **Play here** asks the server to
  `begin` a web session for that program, which mints a session token
  that can only stream poses and report the duck. **Send to <headset>**
  parks the same assignment for a VR station, and the headset claims it.
- The game streams the player's pose (feet, yaw, pitch, in **house
  coordinates**) to `POST /api/spatial/pose` at 10 Hz, latest-only. The
  terminals and the map page watch the same pose stream. Finding the duck
  commits `the simulation completed` + `the golden duck` for the program,
  which releases a corrupted one.

## Running

```bash
pnpm --filter loom-reinstall dev        # :5176, proxies /api + /e to LOOM_SERVER (default :7000)
pnpm --filter loom-reinstall build      # → dist/ (base /reinstall/), served by the event server
pnpm --filter loom-reinstall test       # 538 tests: physics, input, sticks, the pose pump, config, HUD, stream, voice, cams, map editor (ops, yard cut fuzz, speakers, lights), the autopilot
pnpm --filter loom-reinstall typecheck
```

The event server serves `dist/` at **`/reinstall/`**, and the map at
**`/reinstall/map`** (`LOOM_REINSTALL_DIST` overrides the path).

The build targets **`chrome87` / `safari14`** (`vite.config.ts`, the
oldest wall tablets and iPads — OCT31 K-14). That pins syntax only, so a
runtime API newer than Chrome 87 needs a fallback in code: deep copies go
through `@loom/house`'s `cloneData`, never `structuredClone`, and the
scanner box keeps 4:3 without `aspect-ratio`. `scripts/accept/K-14.sh`
scans the built bundles.

## Provisioning a device

Open the setup screen (moderator passcode, a name, a role, the camera), or
provision with one link:

```
https://<site>/reinstall/?code=<mod passcode>&name=Spare tablet&role=both
```

- `role=both` (default): a scanned program **plays here** or is **sent to
  a headset**, whichever you choose. `player` plays here only; `station`
  only sends programs to headsets.
- `camera=environment` uses the back camera (default `user`, the front).
- `arrows=strafe` makes ←/→ strafe instead of turn.

The passcode and the hints are scrubbed from the address bar at once. A
stored token the server no longer accepts sends the device back to setup.
**The camera needs a secure context** (`https://` or `localhost`); without
one, type the program's name instead. Corrupted programs are also offered
as one-tap picks under *In the Internet now*, and restricted ones (not
captured yet: marked by the story, or held by a director's Restrict) under
*Restricted — marked, or held by a director*; the next step shows them as
**STATUS: RESTRICTED — marked for reinstallation** (Play here captures a
marked program; a director's Restrict alone captures nobody). **Only a
captured or restricted program gets in** (wave 16): the server's begin
answers 409 `not marked for reinstallation` for anyone else, so an unmarked
program is never a quick pick, and scanned or typed it reads **Program not
marked** / *Not marked — an Antivirus marks programs for reinstallation.*
with Play here and the headset buttons disabled. With no camera at all the
camera box shrinks to a strip and the step says so.

The game needs **WebGL2** (three r186). A browser without it (3D off, an
old GPU, a locked-down WebView) is probed once: **Play here** is disabled
with the reason, so a session is never begun on a device that can't draw
it. Send the program to a headset, or use another browser.

## A demo with no hardware

Everything runs in desktop browsers against one event server (a laptop
with `pnpm dev`, or the VPS):

1. Open `/reinstall/?code=<mod passcode>&name=Tent tablet` in a desktop
   browser: that window stands in for the tent laptop (on the night the
   laptop runs `/terminal/?code=<mod>&spot=tent&announce=1`, which mounts
   the same flow). The camera may not start (no
   webcam, plain `http://` on a LAN address); that is fine.
2. Join as a guest on a phone (or a phone-sized window) at `/`, and get
   sent to the Internet. That is a performer's button (`send to the
   internet` is `who: performer`, so it is not on Run's cue sheet, which
   lists only the director's cues): sign a second phone in with the
   performer code as an Antivirus (e.g. Norton Anti-Virus) and press
   **🛡 Send to the Internet** on the guest's card, or in Run use the
   identity control to *be* Norton Anti-Virus and press it on the guest
   there. The program then appears under *In the Internet now* on the
   tablet within 10 s: tap it (or type its name), then **Play here**.
3. Walk with **W A S D** / the arrows, look by dragging, **Shift** runs.
   Follow the chevrons. At Gerald the program is released, the phone gets
   *The Golden Duck* and is back on the Desktop.
4. `/terminal/?code=<mod>&name=TV&view=mirror` is the TV. It holds the
   screensaver until Trabolta is introduced (`introduce_trabolta` in the
   cue sheet), then follows whoever is playing.

The layout works from a phone held either way up to a 1280 px laptop
(below 560 px wide or 500 px tall the wizard drops its banner).

## Playing

| | Touch (on-screen sticks) | Keyboard / mouse |
|---|---|---|
| walk | **left stick** (floating: put a thumb anywhere in the lower left) | W A S D, ↑ ↓ (← → strafe with `arrows=strafe`) |
| turn | **right stick**, left–right | Q E, or ← → |
| look up / down | **right stick**, up–down | drag on the view |
| run | n/a | Shift |
| hit the King | **⚔ HIT** under his bar | Space |

The sticks appear on a touch device, or as soon as the screen is touched.
Golden chevrons on the floor lead to Gerald along the house's real route
(doors, stairs). The route is recomputed twice a second. On a stair the
trail leaves it by whichever end is shorter (`trail.ts`): `route()` alone
would point a player who has just stepped onto the foot back at it. The
HUD shows:

- the room you are in and its story location;
- warmer / colder;
- the clock;
- a compass whose gold pip points along the trail;
- the King's shared bar (`n / 15`) once the server shares one, with
  **⚔ HIT** while he is near (below).

**The King.** One health bar for every guest (`KingState` off `hello`,
the map fetch and `king` frames). Near him and facing him, ⚔ / Space
flushes the pose and posts `POST /api/spatial/king/hit` (`game/fight.ts`
pre-checks `kingReach`: *Get closer to the King.* / *Face him.*). The
first hit of a visit says *⚔ You hit the King!*; after that, and on the
server's 409 `already hit`, *You hit him this reinstallation. Find
Gerald before you hit him again.* A visit ends when its duck is found,
not at Leave, a director's end or a pose timeout: a re-scan before the
duck is the same visit, and its assignment's `kingHit` shows ⚔ spent
from the start (`hitSpentAtStart`). At 0 he kneels
for everyone and his door opens (*The King kneels. His door stands
open.*); a restore stands him up (*The King stands again.*) but keeps
the door open for a player behind it or in it until they are clear
(`keepDoorOpen`). There is no chess on the tablet: the game is at the
Server Door terminal (`terminal/`, `view=chess`). An old server that
shares no King shows no bar and no ⚔.

Other players are ghosts wearing their profile picture as a head
(`PlayerState.avatar` → `/e/<id>/api/avatar/<key>`, `@loom/house/three`
`createAvatar`); an `avatar` frame swaps it live.

Gerald quacks when you are near: louder as you get closer, and panned
toward him. Walk within **0.9 m** of him on his floor (and no more than
1.2 m below him — the server's height check) and he lays a golden
egg and flies off. The screen then says **REINSTALLATION COMPLETE** when
the server released a corrupted program, or **YOU FOUND GERALD** for one
that wasn't captured (or was freed mid-walk). A program the story keeps
captured (the banishment: the server answers `released: false` and
`captured: true`) gets **GERALD CAN'T HELP** instead: no egg, no fanfare,
Gerald stays put, and the phone says why. The
server judges by its own copy of the pose (≤ 2 m), so "not yet" is
answered with a buzz and retried, backing off while you stand still. While
the run is paused (the server answers "doors are closed") the HUD says the
simulation is paused instead and keeps retrying on the same backoff, so
the find lands right after the director resumes; a find held by the pause
keeps the session alive (the no-input leash below never runs out on it).

A session ends itself after **120 s with no input**, with a countdown for
the last 20 s. It also ends when the run restarts, when a director ends
it, or when the same program is started on another device. Each of these
returns the device to the scanner with a message. While the tab is hidden,
rendering, the pose keepalives and the idle countdown all pause, so a tab
left hidden for 60 s is dropped by the server rather than shown frozen on
every terminal; coming back resumes the countdown where it was. Leaving
the page (reload, close) ends the session at once.

A session plays only on the map the server dealt it on: "Play here"
fetches the map until it gets the assignment's `houseVersion` (never the
bundled stand-in) and otherwise ends the session and asks for a rescan.
The stream's `hello` (every reconnect) carries the map version too, so a
save made while the tablet's stream was down is still picked up. A save
that moves (or re-deals) this session's duck moves Gerald too: the
session-token map fetch carries the session's current `duck`, and the
stream sends a `duck {session, duck}` frame; either one re-routes the trail.

## The house map — `/reinstall/map`

The plan of one floor at a time (tabs), north up, 1 user unit = 1 m. It
shows:

- rooms with their story LOCATION, walls / fences / rails, doors, stairs
  and props;
- terminals with their view cones, the duck spots and the spawn;
- every program in the simulation, live, with a line to the duck it is
  hunting and a VR / WEB badge.

The map page needs the same device setup (a moderator token).

Tick **Edit** to change the map. A second toolbar row holds the tools
(letters in brackets), the snap step (1 / 5 / 10 / 25 / 50 cm, kept per
device) and **New blank house…** (one floor + a yard, behind a confirm).
The walkthrough for turning a survey into a map is the help article
`docs/help/authoring/39-house-map.md`.

- **floors**: a tab each; **+ Floor** adds one above the top floor (id
  slugged from the label); click the current tab again to edit its label /
  elevation / height or delete it — with a confirm that lists the rooms,
  doors, stairs and things that go with it (never the last floor or the
  spawn's).
- **▭ Room (R) / ▒ Yard (Y)**: drag a rectangle (snapped; edges pull onto
  neighbouring room edges), or type **W × D** and Add (east of the
  selected room, else east of everything on the floor). An indoor room
  drawn, moved or resized over a yard **cuts it** (`yards.ts`): the yard
  is re-split into simple, hole-free pieces with the same label /
  LOCATION, joined by full-edge openings, things in it re-home, doors into
  it re-link, and the room gets a flap door on its side facing the most
  yard. A room that stood in the yard gives its footprint back when it
  moves out or is deleted; **Fill the yard** re-cuts one from its box.
- **▯ Door (D)**: click a wall; the door snaps onto the wall line (0.9 m,
  shorter where the wall is) and its `a` / `b` are the rooms either side
  (one room: `b: null`, to the outside). Drag a door along its wall (it
  re-links where it lands); **Open the whole edge** spans the run.
- **▤ Stairs (S)**: drag the rect on the lower floor; `from` / `to`
  default to the rooms under it here and on the floor above; pick them and
  the rising side in the inspector.
- **↖ Select (V; Esc returns here)**: **drag** a terminal, a duck spot,
  the spawn, a prop, a stair or a door. A thing's `room` follows to
  whichever room on its floor now holds it. Click a room to select it,
  then drag its body to move it — with what stands in it **and the doors
  on its walls**, which re-link to whatever they open on — or drag a
  rectangular room's edge to resize it (doors and wall terminals on that
  edge go with it). The inspector types exact x / z / W / D, label, id,
  LOCATION (a picker over the story's LOCATIONs, from the mod view),
  colour, height and **Outdoor**. **Arrow keys** nudge by the snap step
  (Shift ×10); **Delete** removes (a room with a cascade confirm).
- **turn** a terminal, the spawn or a prop with ⌥ + wheel (5°, Shift 1°),
  `[` / `]`, or its round handle. A terminal's `fov` is the **vertical**
  field of view (three.js; default 70°); its cone on the plan is the
  horizontal view that gives on a landscape 16:10 tablet.
- **view**: the wheel zooms about the cursor, drag empty ground (or hold
  Space, or the middle button) to pan, **Fit** shows the whole house; the
  plan's frame holds still for the length of a drag. The selected room
  shows its W × D.
- **⌘Z / ⇧⌘Z** (⌘Y) undo / redo every edit, including the JSON tab's.
- **🧊 3D** swaps the plan for a 3D preview of the (valid) draft, built by
  the games' own `buildHouseScene` without ceilings (`Preview3D.tsx`, a
  lazy chunk): drag to orbit, wheel to zoom, right-drag to pan; the floor
  being edited, or every floor.
- the **JSON** tab edits the whole map as text. Invalid maps still draw,
  so you can see what's wrong; text that isn't JSON or isn't drawable is
  held back.
- every draft is checked with `validateHouse` as it changes. **Save**
  (enabled only for a valid map) posts it to `POST /api/mod/spatial/house`
  and shows the server's warnings (e.g. a room `location` that names no
  LOCATION). Games and terminals refetch it at once. The save carries the
  version the page loaded (`base`): if another director saved in between,
  nothing is saved and the page says so, with **Copy my edits (JSON)** and
  **Reload the map**. **Revert** goes back to the map as loaded.
- the problem list: `validateHouse` problems first (a click selects the
  room / door / stair / thing a problem names and switches to its floor),
  then **warnings** that never block a save — a duck spot `route()` can't
  reach from the spawn (`check.ts`, the VR autopilot's algorithm), a room
  naming no story LOCATION, a LOCATION no room is.
- when the server can't be reached the page shows the bundled show map
  **read-only** (Edit and Save are off — saving it would replace the
  event's map) with a **Retry**; it reloads the real map by itself once the
  stream reconnects.

The spatial stream (game and map page) reconnects on its own after a
dropped connection, and also after a refusal — behind Caddy a loom
restart answers with a 502, which closes an `EventSource` for good. A
closed stream probes `GET /api/spatial/house` with the same token: 401 /
403 / 404 stop it, anything else reopens on a backoff (1 s … 15 s).

The **Terminals** tab offers each terminal's provisioning link,
`/terminal/?name=<name>&spot=<id>&view=auto`. Links never carry the
passcode: append `&code=<mod passcode>` before opening one on its tablet.

**The project bar** (`src/map/ProjectBar.tsx`; its decisions in
`src/map/project.ts`, unit-tested), mounted in the toolbar by `main.tsx`
through `MapApp`'s `toolbarExtras` slot (`projectBarExtras`). The
toolbar's status line names the map's source with `sourceLabel` (this
event's map / the project's map / the show's map). **Map:** a toggle per
whole-map variant of the event (`GET /api/mod/spatial/variants`), labelled
in a director's words by `variantLabel`: `house.shed.json` → **Shed**,
the default `house.json` → the one word only its map's name has among the
variants (the show's → **Tent**), else **Main**; the playing one is
pressed and tagged **● live**, the file + map name are the tooltip, a
broken one is disabled with its problems. A click switches the live map
(`POST /api/mod/spatial/variant {file, base}`), asking first while
programs are mid-game (they keep playing; a duck whose spot is gone is
re-dealt; one standing where the new variant has no floor goes back to
the start — `bodyAfterRemap` in `game/physics.ts`, the same `standable`
rule the server re-seats by), when it would drop a director's save, or when the page holds
unsaved edits. The switch is already live for every player, so the page
then **reloads** onto the server's map and version as a clean draft (not
an undoable adopt — undoing would only make an unsaved edit of the old
variant). **Save to project** (an event with a project only) writes the
map into the project as the active variant's file (`POST
/api/mod/spatial/house/project`), so the next launch and every co-writer
get it; a valid unsaved draft is 💾 saved to the event first, so what is
on screen is what lands (an invalid one is not — the bar asks before
saving the event's map without it); the page reloads after. **Download
JSON** saves the shown map under that file name.

To change the show's own map (`core/examples/trapped-in-the-internet/house.json`),
**Download JSON** (or copy the JSON tab) into that file, then run
`pnpm --filter @loom/house goldens && pnpm --filter @loom/house sync`
(the Godot copy and the conformance goldens follow it).

## Layout

| | |
|---|---|
| `src/app.tsx` | the device's screens: setup → scan → choose (play here / send to a headset) → play |
| `src/flow.tsx`, `src/flow-state.ts` | the choose / play / send flow, lifted out so the tent laptop's terminal mounts it (`firstStep`) |
| `src/program.ts` | a program's state for the wizard (`corrupted` / `favour` / `marked` / `held` / `healthy`), `beginErrorText` |
| `src/config.ts` | provisioning + the stored device config |
| `src/api.ts`, `src/spatial.ts` | the spatial routes; the stream folded into a player table |
| `src/wizard.tsx` | the Win98 "Reinstallation Wizard" chrome |
| `src/game/engine.ts` | the imperative game: three.js scene (`@loom/house/three`), camera, ghosts, trail, found |
| `src/game/Play.tsx`, `joystick.tsx` | the play screen, HUD and the on-screen sticks |
| `src/game/physics.ts` | **pure**: the walker (circle vs. walls / rails / fences / solid props, `heightAt` floors + ramps, step-up 0.45 m, substeps, sliding) |
| `src/game/input.ts` | **pure**: keyboard + sticks + drag → one frame of intent; stick maths (dead zone 0.12) |
| `src/game/pump.ts` | **pure**: the 10 Hz latest-only pose pump (keepalive, backoff, stop on 401 / 410) |
| `src/game/hud.ts` | **pure**: room names, warmer / colder, compass, reach |
| `src/game/fight.ts` | **pure**: the King's HUD lines and meter, `kingReach` (re-exported from `@loom/house`), `keepDoorOpen` |
| `src/game/trail.ts` | **pure**: the chevrons' path, `route()` made walkable on a stair (`test/autopilot.test.ts` walks the real physics along it to every duck spot, on the show's map and the three-floor fixture) |
| `src/game/leash.ts` | **pure**: the 120 s no-input leash (paused while the tab is hidden) |
| `src/game/audio.ts` | WebAudio quack, fanfare and buzz (no assets); `createSfx(output?)` plays on a host's bus |
| `src/game/cams.ts` | the terminals' camera feeds hung on the virtual walls |
| `src/game/voice.ts` | the voice link with the terminals (`VoiceLink`; off by default, `voice=1`) |
| `src/map/MapApp.tsx` | the map page's state: load / save / stream, undo history, keys; `toolbarExtras` render prop (`MapToolbarContext`) for the project bar |
| `src/map/Canvas.tsx`, `Toolbar.tsx`, `Inspector.tsx`, `Panels.tsx` | the plan + gestures, the toolbar, the inspector, the other tabs + the problem list |
| `src/map/plan.ts`, `edit.ts` | **pure**: SVG frame, hit tests, snapping, zoom / pan; edit ops, JSON drafts |
| `src/map/doors.ts`, `yards.ts`, `structure.ts` | **pure**: doors on wall lines; the yard cut; floors / rooms / stairs / blank house with cascades |
| `src/map/history.ts`, `check.ts`, `tools.ts` | **pure**: undo / redo; structured problems + walkability + LOCATIONs; tools + selection floors |
| `src/map/project.ts`, `ProjectBar.tsx` | **pure** + view: the project bar (variants, save to project, download), mounted through `toolbarExtras` |
| `src/map/props.ts` | **pure**: props, terminals, the King: place, drag, turn, duplicate, wall snap |
| `src/map/audio.ts`, `AudioPanel.tsx`, `audio-api.ts`, `audio-poll.ts` | the speakers and the 🔊 Audio tab (`audio.json` through `/api/mod/audio`) |
| `src/map/lights.ts`, `LightsPanel.tsx`, `lights-api.ts`, `lights-poll.ts` | the lights and the 💡 Lights tab (`lights.json` through `/api/mod/lights`) |

It reuses the terminal's scanner and pass parsing (`@loom/terminal/scanner.tsx`,
`scan.ts`) and the play app's `api` / `ApiError` (`@loom/play/client.ts`)
as source, through Vite aliases. The show's `house.json` is bundled as
the offline fallback when the server can't hand over a map.
