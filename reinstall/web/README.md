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
pnpm --filter loom-reinstall test       # physics, input, sticks, the pose pump, config, HUD, stream, map helpers, the autopilot
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
as one-tap picks under *In the Internet now*. With no camera at all the
camera box shrinks to a strip and the step says so.

The game needs **WebGL2** (three r186). A browser without it (3D off, an
old GPU, a locked-down WebView) is probed once: **Play here** is disabled
with the reason, so a session is never begun on a device that can't draw
it. Send the program to a headset, or use another browser.

## A demo with no hardware

Everything runs in desktop browsers against one event server (a laptop
with `pnpm dev`, or the VPS):

1. Open `/reinstall/?code=<mod passcode>&name=Tent tablet` in a desktop
   browser: that window is the tent tablet. The camera may not start (no
   webcam, plain `http://` on a LAN address); that is fine.
2. Join as a guest on a phone (or a phone-sized window) at `/`, and get
   sent to the Internet: an Antivirus performer's **Send to the Internet**,
   or the director's cue sheet in Run. The program then appears under
   *In the Internet now* on the tablet within 10 s: tap it (or type its
   name), then **Play here**.
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

The sticks appear on a touch device, or as soon as the screen is touched.
Golden chevrons on the floor lead to Gerald along the house's real route
(doors, stairs). The route is recomputed twice a second. On a stair the
trail leaves it by whichever end is shorter (`trail.ts`): `route()` alone
would point a player who has just stepped onto the foot back at it. The
HUD shows:

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

Tick **Edit** to change the map:

- **drag** a terminal, a duck spot, the spawn or a prop. Its `room`
  follows to whichever room on its floor now holds it. **Arrow keys**
  nudge 5 cm (Shift: 50 cm).
- **turn** a terminal, the spawn or a prop with the mouse wheel (5°, Shift
  1°) or its round handle. A terminal's `fov` is the **vertical** field of
  view (three.js; default 70°); its cone on the plan is the horizontal view
  that gives on a landscape 16:10 tablet.
- **+ Terminal / + Duck spot** add one in the selected room. **Delete**
  removes one; the last duck spot always stays.
- **rooms**: click a rectangular (4-vertex) room to select it, then drag
  it to move it with everything in it, or drag an edge to resize it. Both
  snap to 5 cm. Doors and stairs stay put: the problem list says which to
  re-place. Other polygons are edited in the JSON tab. The plan's frame
  holds still for the length of a drag.
- the **JSON** tab edits the whole map as text. Invalid maps still draw,
  so you can see what's wrong; text that isn't JSON or isn't drawable is
  held back.
- every draft is checked with `validateHouse` as it changes. **Save**
  (enabled only for a valid map) posts it to `POST /api/mod/spatial/house`
  and shows the server's warnings (e.g. a room `location` that names no
  LOCATION). Games and terminals refetch it at once. The save carries the
  version the page loaded (`base`): if another director saved in between,
  nothing is saved and the page says so, with **Copy my edits (JSON)** and
  **Reload the map**. **Undo** (⌘Z) and
  **Revert** are there for mistakes.
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
| `src/game/trail.ts` | **pure**: the chevrons' path, `route()` made walkable on a stair (`test/autopilot.test.ts` walks the real physics along it to every duck spot, on the show's map and the three-floor fixture) |
| `src/game/leash.ts` | **pure**: the 120 s no-input leash (paused while the tab is hidden) |
| `src/game/audio.ts` | WebAudio quack, fanfare and buzz (no assets) |
| `src/map/` | the map page; `plan.ts` (SVG frame, hit tests, snapping) and `edit.ts` (edit ops, JSON drafts) are pure |

It reuses the terminal's scanner and pass parsing (`@loom/terminal/scanner.tsx`,
`scan.ts`) and the play app's `api` / `ApiError` (`@loom/play/client.ts`)
as source, through Vite aliases. The show's `house.json` is bundled as
the offline fallback when the server can't hand over a map.
