# Reinstallation — the golden-duck games

*Trapped in the Internet*: a program the Antivirus dragged into **The
Internet** (the tent) is *reinstalled* by proving, in a simulation, that it
can follow instructions. It walks a **virtual copy of the house** along the
golden chevrons and finds **Gerald, the golden duck**. Walking up to the duck
is enough: nothing needs a button. The design contract for every piece below
is [`docs/loom-reinstall.md`](../docs/loom-reinstall.md), and it is normative.

| Piece | Where | What it is |
|---|---|---|
| [`web/`](./web) (`loom-reinstall`) | `/reinstall/` on the event server | The **tablet game**: Vite + React + three.js. Its screens are setup → scan a pass → **Play here** or **Send to <headset>** → play → found. You move with the on-screen twin sticks or the keyboard. The same app serves the **house map** viewer and editor at `/reinstall/map`. §3. |
| [`vr/`](./vr) | Quest 3 headsets in the tent | The **VR game**: a Godot 4.7 OpenXR project, thumbsticks only. A headset is a station that polls for work, or its wearer picks a program with the stick. On a Mac it runs as a desktop game. §5. |
| [`../house`](../house) (`@loom/house`) | shared | The **house map**: one frame (metres, Y up, `+z` south). It holds the schema, validation, the procedural geometry, `locate` and `route`, and the duck pick. `@loom/house/three` is the three.js scene that the web game and the terminals both render. §1. |
| [`../core/server/spatial.ts`](../core/server/spatial.ts) | the event server | `SpatialHub` holds sessions, stations, poses, and a found check gated on distance and height (`nearDuck`), refused while the run is paused. Only the outcome ever reaches the journal: `the simulation completed` + `the golden duck`. A map save carries live sessions over and moves their ducks (`duck` frame). §2. |
| [`../terminal/src/world/`](../terminal/src/world) | the wall tablets | The **world view**: each terminal shows the players exploring, seen from where it hangs on the real wall. `view=mirror` is the TV. §4. |

The show's map is
[`core/examples/trapped-in-the-internet/house.json`](../core/examples/trapped-in-the-internet/house.json).
It is a placeholder until the house is measured (the tent is out in the
backyard; `house.shed.json` beside it is the rain variant, The Internet
in the shed — the same terminal ids and duck spots). **The map belongs to the
project**: `house.json` and any `house.<variant>.json` (the rain plan's
`house.shed.json`) are project files beside the story, pushed by
`pnpm sync-example` / `pnpm sync-show` and snapshotted when an event
launches (a reload refreshes them; End → relaunch plays the project's
current map, on the variant the last event played). An event plays, in order: a director's save from
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

The code: `src/map/MapApp.tsx` (state, load / save), `Canvas.tsx` (the
plan + gestures), `Toolbar.tsx`, `Inspector.tsx`, `Panels.tsx`, and the
pure ops `edit.ts` / `doors.ts` / `yards.ts` / `structure.ts` /
`history.ts` / `check.ts` (tested in `test/map*.test.ts`, the yard cut
fuzzed against `validateHouse`). `MapApp` takes a `toolbarExtras` render
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
pnpm --filter loom-reinstall test          # web: physics, input, pose pump, HUD, map editor
pnpm --filter @loom/house test             # the map + the §1.2 goldens
pnpm test:vr                               # = reinstall/vr/test/run.sh (needs Godot 4.7)
```

To provision a device, open a link that carries the event's **moderator**
passcode. The device trades it for a moderator token and does not store the
passcode:

```
/reinstall/?code=<mod>&name=Tent tablet
/terminal/?code=<mod>&name=Kitchen&character=Trabolta&spot=kitchen&view=auto
```

At *Trapped in the Internet* the wall terminals are provisioned
`view=auto` from the start: they hold a screensaver until Clippy introduces
Trabolta (`introduce_trabolta`), then flip to his face within 2 s (see
[`terminal/README.md`](../terminal/README.md) → *Before the character
exists*). In the tent, the story's `WebMD` messages
each captured program the reinstallation instructions (`cue tablet_webmd` is
reserved for a future instructional video in the tablet wizard).

A headset is configured with `user://station.json` or command-line flags;
see [`vr/README.md`](./vr/README.md). The Docker image serves `web/` (the
`/reinstall/` route) but not the Godot project. Headsets are exported and
sideloaded separately, by `vr/tools/quest.sh` (`setup` / `build --station
vr-N` / `install`). Each APK is release-signed with its station baked in
and talks to the VPS over HTTPS. The acceptance check is
`scripts/accept/K-30.sh`.

**End to end.** `vr/` has an `--autopilot` mode
(`godot --headless --path reinstall/vr --xr-mode off -- --server … --code
<mod> --guest g-… --autopilot`). In it the game walks to the duck through
its real physics against a live event server, then exits with 0 after a
find.
