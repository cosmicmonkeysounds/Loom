# Reinstallation — the golden-duck games

*Trapped in the Internet*: a program the Antivirus dragged into **The
Internet** (the tent) is *reinstalled* by proving, in a simulation, that it
can follow instructions. It walks a **virtual copy of the house** along the
golden chevrons and finds **Gerald, the golden duck**. Walking up to the duck
is enough: nothing needs a button. The design contract for every piece below
is [`docs/loom-reinstall.md`](../docs/loom-reinstall.md), and it is normative.
Agents working here: [`CLAUDE.md`](./CLAUDE.md).

**Who gets in.** Only a program the story marked for reinstallation, or one
already captured into the Internet, may play (wave 16): the server's begin
answers 409 `not marked for reinstallation` for anyone else, and the tent
laptop shows them a NOT MARKED card. After an ending anyone may play (the
party favour).

| Piece | Where | What it is |
|---|---|---|
| [`web/`](./web) (`loom-reinstall`) | `/reinstall/` on the event server | The **web game**: Vite + React + three.js. Its screens are setup → scan a pass → **Play here** or **Send to <headset>** → play → found. You move with the on-screen twin sticks or the keyboard; **⚔ HIT** (or Space) is this visit's one hit on **the King** (below). On the night it runs inside the tent laptop's terminal (`view=reinstall`); the standalone page is for a spare device. The same app serves the **house map** editor at `/reinstall/map` (rooms, doors, stairs, props, terminals, speakers and lights). §3. |
| [`vr/`](./vr) | Quest 3 headsets in the tent | The **VR game**: a Godot 4.7 OpenXR project, thumbsticks plus the trigger (or A / X) for the King. A headset is a station that polls for work, or its wearer picks a program with the stick. On a Mac it runs as a desktop game. §5. |
| [`../house`](../house) (`@loom/house`) | shared | The **house map**: one frame (metres, Y up, `+z` south). It holds the schema (incl. the `king` prop and a door's `guard`), validation, the procedural geometry, `locate` and `route` (a guarded door is shut until its King falls), the King's reach rule (`kingReach`), and the duck pick. `@loom/house/three` is the three.js scene that the web game and the terminals both render: the King with his shared bar, and ghosts wearing profile pictures. §1. |
| [`../core/server/spatial.ts`](../core/server/spatial.ts) | the event server | `SpatialHub` holds sessions, stations, poses, and a found check gated on distance and height (`nearDuck`), refused while the run is paused. Only the outcome ever reaches the journal: `the simulation completed` + `the golden duck`, and a hit on the shared King (`POST /api/spatial/king/hit`: his health into `Night.king_hp`, then `king hit` / `king fallen`). A map save carries live sessions over and moves their ducks (`duck` frame). Each player carries their profile picture's avatar key (`avatar` frame on a change). §2. |
| [`../terminal/src/world/`](../terminal/src/world) | the wall tablets | The **world view**: each terminal shows the players exploring, seen from where it hangs on the real wall. `view=mirror` is the TV. §4. |
| [`../terminal/src/reinstall/`](../terminal/src/reinstall) | the tent laptop | **The reinstallation station** (wave 18b, `view=reinstall`): the laptop in the tent is a wall terminal *and* this app's wizard — the idle show, the scan box and the captured programs between walks, then `web/`'s own flow (`flow.tsx`) and game in a shadow root. An unmarked pass gets only a NOT MARKED card; an overlay holds a walk. §3. |
| [`../chess`](../chess) (`@loom/chess`) | the Server Door terminal | **The King's chess**: the rules, his AI per stage of the shared bar, and the board. It is played only at the wall terminal outside the real server-room door (`terminal/`, `view=chess`), never in either game. §4. |

**A server restart ends every walk.** `SpatialHub` keeps sessions,
session tokens and parked station assignments in memory, so a crash, a
redeploy or a SIGTERM restart ends a player mid-walk: the next pose or map
fetch answers 401, the tablet or headset treats the session as over, and
the program is **scanned again** at the wizard (or sent to the headset
again). Ducks already found stay found (`spatial-runs.jsonl`, the recap's
speedrun board).

The show's map is
[`core/examples/trapped-in-the-internet/house.json`](../core/examples/trapped-in-the-internet/house.json).
It was drawn from the real house in the map editor on 2026-10-20 (three
floors plus the backyard, with the tent in its south-east corner);
`house.shed.json` beside it is the rain variant, The Internet in the shed
(the same terminal ids and duck spots; the tent spot and the spawn move
into the shed). **The map belongs to the
project**: `house.json` and any `house.<variant>.json` (the rain plan's
`house.shed.json`) are project files beside the story, pushed by
`pnpm sync-example` / `pnpm sync-show` and snapshotted when an event
launches (a reload refreshes them; End → relaunch plays the project's
current map, on the variant the last event played). A sync keeps a
project map that differs from the repo's (it only warns), so a change made
here (the King's `hp: 15` + `health`, the Server Door spot, the `"variant"` labels) reaches a project that
already has maps only through one `pnpm sync-show --replace-maps`, run
after checking the project's maps carry no surveyed edits worth keeping. An event plays, in order: a director's save from
`/reinstall/map` (kept per event in the server's state directory as
`spatial-house.json`), the project's active variant, then the show file
(`LOOM_HOUSE`, now only the fallback). A save carries the version the
editor loaded, so two directors never silently overwrite each other (409,
then reload). The **tent ↔ shed switch** is `POST /api/mod/spatial/variant
{file}` (mid-show too: players keep playing, a duck whose spot is gone is
re-dealt, and a player standing where the new variant has no floor — the
shed is a solid prop on the tent map — goes back to the start); **Save to project** (`POST /api/mod/spatial/house/project`)
writes the event's map back into the project. The map page's
project bar (`map/ProjectBar.tsx`, mounted in the editor's toolbar slot
by `main.tsx`) offers both as **Map: Tent ● live | Shed** buttons, plus
**Download JSON**; a switch reloads the page onto the server's new map
(`docs/loom-reinstall.md` §1.3, §2.1).

### The King (one shared health bar)

A `king` prop stands in the server-room doorway of the show's map
(`cold-lock-king`, `hp: 15`, `health: "Night.king_hp"`; the door
`server-door` names him as its `guard`), and the door is shut — a closed
leaf in the gap — until he falls. He has **one health bar for every
guest, all night**: the server holds it in the story's `Night.king_hp`
(15 at Power On, never regenerating) and sends it as `KingState {id, hp,
max, fallen}` on `hello`, the session's map fetch and a `king` frame on
every change.

- **One hit per program per reinstallation visit.** On the tablet
  **⚔ HIT** or Space, in a headset the trigger or A / X, within 1.25 m
  and facing him within 55° (`kingReach`; the game pre-checks it and
  says *Get closer to the King.* / *Face him.*). The game flushes its
  pose and posts `POST /api/spatial/king/hit`; the server judges the
  reach on that pose (with slack), takes a point off, and fires `king
  hit` for the guest (`king fallen` at 0). A visit lasts until that
  guest's duck is found: Leave + re-scan, a director's end, a timeout
  or a re-scan mid-walk is the same visit. The assignment's `kingHit`
  says so, so ⚔ shows as spent from the start, with *You hit him this
  reinstallation. Find Gerald before you hit him again.* (also the line
  for a 409 `already hit`). A story reset or a server restart forgets the
  visits.
- **The HUD** carries no King bar or stage line (wave 26, R3): the bar
  over his head is his only display. On the tablet **⚔ HIT** shows while
  he is near and standing; in VR a notice says to pull the trigger.
  Another program's hit staggers him on every screen.
- **At 0 he kneels** for everyone: down on one knee, his collider and
  the door leaf gone, the trail routed through the door
  (`withFallenKings`). A director's restore (👑, or Run → House map
  **Set…**) stands him up and shuts the door again — but not on a
  player behind it, in the doorway or on his spot: for them it stays
  open until they are clear (`keepDoorOpen`, VR `keep_door_open`), and a
  remap keeps a player on a fallen King's spot where they are.
- **No chess here.** His bar sets how well he plays at the **Server
  Door** terminal outside the real server-room door (`@loom/chess`,
  `terminal/`, `view=chess`): full = grandmaster … 0 = pawns only.
  Nothing in either game posts a chess result.

The design is `docs/loom-reinstall.md` §3 *The King*; the director's
side is Help → *Running the server room*.

**Ghosts wear profile pictures.** Every player on the stream carries
`avatar`, the guest's avatar key; the web game, the terminals and VR
cut the event's `/api/avatar/<key>` into a glitchy swarm that holds to the
body's capsule (the collider, never drawn) and tears into a face that
stares at you; the terminals show the same swarm, over their camera in the
shadow view. No picture, or one that won't load, is the same swarm as
static in the ghost's tint.

### The voice link (wave 19)

The players and the wall terminals hear each other, like the camera
feeds (`docs/loom-reinstall.md` §2.4): a terminal's mic is heard in the
game at that terminal's screen, and a player's mic on the terminals near
them. G.711 μ-law, 16 kHz mono, 200 ms chunks, up by raw `POST
/api/spatial/voice?seq=` (the session token), down on one SSE stream
(`/api/spatial/voice/stream`) that carries only what this player can hear,
each chunk with the server's gain. The codec, the gate, the resampler, the
jitter rule and who-hears-whom are `@loom/house` `voice.ts`. No
game-to-game voice: two players never hear each other.

- **The web game has it off by default.** It runs on the tent laptop,
  which is the tent's own terminal (the tent's spot is `voice: false` on
  both show maps), so the tent never talks to itself. Turn it on for a
  device elsewhere with **🎤 Voice link with the terminals** in Setup or
  `&voice=1` on the provisioning link (`&voice=0` turns it off).
- With it on, **Play here** asks for the mic in the same tap (the
  browser's permission prompt; it needs https or localhost). The HUD's
  **🎤 LIVE / MUTED / NO MIC** toggles it (or **M**), and the status line
  says *🎤 2 terminals can hear you* while the server says one does.
  Nothing goes up unless a terminal can hear the player and the level
  clears the gate (−42 dBFS, 400 ms hang). While a terminal's voice plays
  on this device (+300 ms) the gate is **raised** to −28 dBFS, not shut
  (D5b, the barge-in): the speakers' echo stays home, a player speaking up
  goes — and the terminal, playing them, holds its own mic, so the room
  pauses for them (a hard hold on both ends let a loud room keep the floor
  for good). The mic is low-passed at 7 kHz first. Voices play from their
  screens (`PannerNode`s, equalpower; the server's gain is the volume),
  ~200 ms behind; a skip ahead cuts only what is queued past the target,
  with a 5 ms fade. *N terminals can hear you* is the server's `ears`.
- `src/game/voice.ts` (`VoiceLink`) runs on the camera feeds' gate
  (playing, on screen) and stops with the session, mic tracks and all;
  every effect is injected, so `test/voice.test.ts` drives it in node.
- In a headset, **B / Y** mutes (**M** on a desktop run); the terminals
  have their own ⚙ `mic` / `voices` switches.

### The map editor (`/reinstall/map`)

Tick **Edit** to build the house from a survey (the walkthrough is the
help article `docs/help/authoring/39-house-map.md`; the rules are
`docs/loom-reinstall.md` §3):

| Tool / control | Does |
|---|---|
| floor tabs, **+ Floor** | switch floors; add one above the top; click the current tab to edit / delete it |
| **▭ Room** (R) | drag a rectangle, or type **W × D** + Add (lands east of the selected room) |
| **▒ Yard** (Y) | an outdoor rectangle; an indoor room drawn in it (the tent, the shed) is cut out of it — a free-standing one with a flap door (a notice says so), and any part of the yard the cut seals off gets one; a yard in pieces is selected / renamed / deleted whole |
| **▯ Door** (D) | click a wall: snaps on, 0.9 m, joins the rooms either side (one room = outside) |
| **▤ Stairs** (S) | drag the rect on the lower floor, pick the rooms + the rising side |
| **↖ Select** (V, Esc) | click / drag; a selected room by its body (with its doors and contents) or an edge |
| snap, wheel, Space-drag | 1–50 cm snap with room edges pulled onto neighbours'; zoom; pan |
| ⌘Z / ⇧⌘Z | undo / redo every edit |
| **🧊 3D** | the draft as the games build it (`buildHouseScene`, no ceilings; a lazy chunk), this floor or every floor |
| inspector numbers | commit on Enter / blur (a typed prefix is never applied as a resize); spinner steps at once |
| problem list | `validateHouse` problems (click selects), warnings: unreachable duck spots, rooms no door leads into, LOCATION mismatches |
| place palette | props (incl. the King), terminals, duck spots, the spawn, **🔊 speakers** and **💡 lights**: drag, turn, ⌘D, Delete, arrows |
| **🔊 Audio** tab | `audio.json`: the interface's inputs and outputs, the routing matrix, zones, where each story sound plays, the tablets that also say announcements, 🔈 Test per speaker and output |
| **💡 Lights** tab | `lights.json`: fixtures, the Zigbee2MQTT devices + *Pair new device*, zones, looks with a step builder and ▶ Test |

The code: `src/map/MapApp.tsx` (state, load / save), `Canvas.tsx` (the
plan + gestures), `Toolbar.tsx`, `Inspector.tsx`, `Panels.tsx`, and the
pure ops `edit.ts` / `doors.ts` / `yards.ts` / `structure.ts` /
`history.ts` / `check.ts` / `props.ts`, the speakers' `audio.ts` +
`AudioPanel.tsx` and the lights' `lights.ts` + `LightsPanel.tsx` (tested in
`test/map*.test.ts` and friends, the yard cut fuzzed against
`validateHouse`). One undo history covers the map, the speakers and the
lights; each file saves with its own `base` version (409 on a stale save). `MapApp` takes a `toolbarExtras` render
prop (`MapToolbarContext` in `tools.ts`) — the slot for the project bar.

After you edit the show's file, regenerate the Godot goldens and the Godot
copy of the map:

```bash
pnpm house:sync          # = @loom/house goldens + sync → vr/house/house.json, vr/test/golden/
```

## Running and testing

```bash
pnpm dev                                   # builds play + terminal + reinstall; server :7000
                                           # → http://localhost:7000/reinstall/  (map: /reinstall/map)
pnpm dev --reinstall                       # + the game's own Vite with HMR on :5176
pnpm --filter loom-reinstall test          # web: physics, input, pose pump, HUD, map editor,
                                           #   speakers, lights, the King's hit, the moments (623 tests)
pnpm --filter @loom/house test             # the map + the §1.2 goldens (378 + 4 skipped)
pnpm --filter @loom/chess test             # the King's chess (23)
pnpm test:vr                               # = reinstall/vr/test/run.sh (needs Godot 4.7;
                                           #   730 checks + 27 for tools/quest.sh)
```

To provision a device, open a link that carries the event's **moderator**
passcode. The device trades it for a moderator token and does not store the
passcode. The map's spot sets the view and the name, so a link needs only
the spot:

```
/terminal/?code=<mod>&spot=tent&announce=1        # the tent laptop (John's old laptop)
/terminal/?code=<mod>&spot=start-bar              # a wall tablet
/terminal/?code=<mod>&spot=server-room-door       # the King's chess board
/reinstall/?code=<mod>&name=Spare tablet          # the standalone wizard on a spare device
```

Every device in the show, with its kiosk flags, is in
[`docs/trapped/kiosk.md`](../docs/trapped/kiosk.md).

At *Trapped in the Internet* the wall terminals are provisioned
`view=auto` from the start: they hold a screensaver until Clippy introduces
Trabolta (`introduce_trabolta`), then flip to his face within 2 s (see
[`terminal/README.md`](../terminal/README.md) → *What a wall terminal
does*). In the tent — in the backyard, through the tunnel — the story's
**Installation Wizard** (a voice, not a performer: `cast/staff.loom`,
`beats/internet.loom`) messages each captured program the reinstallation
instructions in its own `dm:Installation Wizard` thread, and `cue
tablet_wizard` puts the station's *Setup is preparing to reinstall a
program* card up on the tent laptop (it names nobody). The laptop is the
wall terminal at `view=reinstall` (wave 18b); the standalone `/reinstall/`
page stays for a spare tablet, a headset-only controller and the map
editor.

A headset is configured with `user://station.json` or command-line flags;
see [`vr/README.md`](./vr/README.md). The Docker image serves `web/` (the
`/reinstall/` route) but not the Godot project. Headsets are exported and
sideloaded separately, by `vr/tools/quest.sh` (`setup` / `build --station
vr-N` / `install`). Each APK is release-signed with its station baked in
and talks to the VPS over HTTPS. The acceptance check is
`scripts/accept/K-30.sh`.

**A demo with no hardware** (a desktop browser as the tent laptop, a phone
or a second window as the guest, the keyboard to walk) is spelled out in
[`web/README.md`](./web/README.md) → *A demo with no hardware*. The web
game's own autopilot (`web/test/autopilot.test.ts`) walks the real physics
along the trail to every duck spot of the show's map and of
`house/test/fixtures/three-floors.json` (basement / main / top + the tent,
two flights end to end in the hall; a stairwell stacked flight over flight
is refused by `validateHouse`, so offset the flights in plan).

**End to end.** `vr/` has an `--autopilot` mode
(`godot --headless --path reinstall/vr --xr-mode off -- --server … --code
<mod> --guest g-… --autopilot`). In it the game walks to the duck through
its real physics against a live event server, then exits with 0 after a
find.
