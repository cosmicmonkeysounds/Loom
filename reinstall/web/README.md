# loom-reinstall — the reinstallation game (web) + the house map

A program the Antivirus dragged into **The Internet** is *reinstalled* by
proving it can follow instructions: it walks a **virtual copy of the
house** and finds **Gerald, the golden duck**. This app is the web half of
that game (the VR half is the Godot project in `../vr/`), plus the
**house map** viewer / editor that every spatial piece is placed with.
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
pnpm --filter loom-reinstall test       # physics, input, sticks, the pose pump, config, HUD, stream, map editor (ops, yard cut fuzz)
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
http://<server>/reinstall/?code=<mod passcode>&name=Tent tablet&role=both
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
as one-tap picks under *In the Internet now*.

## Playing

| | Touch (on-screen sticks) | Keyboard / mouse |
|---|---|---|
| walk | **left stick** (floating: put a thumb anywhere in the lower left) | W A S D, ↑ ↓ (← → strafe with `arrows=strafe`) |
| turn | **right stick**, left–right | Q E, or ← → |
| look up / down | **right stick**, up–down | drag on the view |
| run | n/a | Shift |

The sticks appear on a touch device, or as soon as the screen is touched.
Golden chevrons on the floor lead to Gerald along the house's real route
(doors, stairs). The route is recomputed twice a second. The HUD shows:

- the room you are in and its story location;
- warmer / colder;
- the clock;
- a compass whose gold pip points along the trail.

Gerald quacks when you are near: louder as you get closer, and panned
toward him. Walk within **0.9 m** of him on his floor (and no more than
1.2 m below him — the server's height check) and he lays a golden
egg and flies off. The screen then says **REINSTALLATION COMPLETE** for a
corrupted program, or **YOU FOUND GERALD** for one that wasn't. The
server judges by its own copy of the pose (≤ 2 m), so "not yet" is
answered with a buzz and retried, backing off while you stand still. While
the run is paused (the server answers "doors are closed") the HUD says the
simulation is paused instead and keeps retrying on the same backoff, so
the find lands right after the director resumes.

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
`docs/help/authoring/38-house-map.md`.

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

The **Terminals** tab offers each terminal's provisioning link,
`/terminal/?name=<name>&spot=<id>&view=auto`. Links never carry the
passcode: append `&code=<mod passcode>` before opening one on its tablet.

To change the show's own map (`core/examples/trapped-in-the-internet/house.json`),
copy the JSON tab into that file, then run
`pnpm --filter @loom/house goldens && pnpm --filter @loom/house sync`
(the Godot copy and the conformance goldens follow it).

## Layout

| | |
|---|---|
| `src/app.tsx` | the device's screens: setup → scan → choose (play here / send to a headset) → play |
| `src/config.ts` | provisioning + the stored device config |
| `src/api.ts`, `src/spatial.ts` | the spatial routes; the stream folded into a player table |
| `src/wizard.tsx` | the Win98 "Reinstallation Wizard" chrome |
| `src/game/engine.ts` | the imperative game: three.js scene (`@loom/house/three`), camera, ghosts, trail, found |
| `src/game/Play.tsx`, `joystick.tsx` | the play screen, HUD and the on-screen sticks |
| `src/game/physics.ts` | **pure**: the walker (circle vs. walls / rails / fences / solid props, `heightAt` floors + ramps, step-up 0.45 m, substeps, sliding) |
| `src/game/input.ts` | **pure**: keyboard + sticks + drag → one frame of intent; stick maths (dead zone 0.12) |
| `src/game/pump.ts` | **pure**: the 10 Hz latest-only pose pump (keepalive, backoff, stop on 401 / 410) |
| `src/game/hud.ts` | **pure**: room names, warmer / colder, compass, reach |
| `src/game/leash.ts` | **pure**: the 120 s no-input leash (paused while the tab is hidden) |
| `src/game/audio.ts` | WebAudio quack, fanfare and buzz (no assets) |
| `src/map/MapApp.tsx` | the map page's state: load / save / stream, undo history, keys; `toolbarExtras` render prop (`MapToolbarContext`) for the project bar |
| `src/map/Canvas.tsx`, `Toolbar.tsx`, `Inspector.tsx`, `Panels.tsx` | the plan + gestures, the toolbar, the inspector, the other tabs + the problem list |
| `src/map/plan.ts`, `edit.ts` | **pure**: SVG frame, hit tests, snapping, zoom / pan; edit ops, JSON drafts |
| `src/map/doors.ts`, `yards.ts`, `structure.ts` | **pure**: doors on wall lines; the yard cut; floors / rooms / stairs / blank house with cascades |
| `src/map/history.ts`, `check.ts`, `tools.ts` | **pure**: undo / redo; structured problems + walkability + LOCATIONs; tools + selection floors |

It reuses the terminal's scanner and pass parsing (`@loom/terminal/scanner.tsx`,
`scan.ts`) and the play app's `api` / `ApiError` (`@loom/play/client.ts`)
as source, through Vite aliases. The show's `house.json` is bundled as
the offline fallback when the server can't hand over a map.
