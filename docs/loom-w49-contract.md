# Wave 49 contract: the descent

2026-10-30. Lanes `oct31-w49/<lane>`. This file is the interface between the
lanes: names, shapes and files here are binding; anything not written here is
the lane's own choice. When code and this file disagree, fix one of them in
the same change.

## C0. What the user asked for

1. **The map editor belongs in Loom Edit**, not behind a hidden link.
2. **More props**: BBQ, stove, broken microwave, modular synth, and so on.
3. **The more a program is reinstalled, the more the game comes apart**: more
   random hallucination moments.
4. **Props start to talk**, and other narrative events happen the more you
   visit. House of Leaves and Alice in Wonderland. VR dialogue may be basic but
   has multiple options; the web game reuses what it has.
5. **Footsteps**: as a program pulses the real light it walks under (wave 39),
   the real house hears it walk, by room presence and closeness to speakers.

Decisions taken for the lanes (the user can overrule any of them):

- **The first walk stays clean.** The level is the finds behind a walk
  (`reinstalled`), capped at 4. A program sees talking props on its second
  walk. A director can force a level (C3.3), mostly to test.
- **Nothing here can stop a walk.** A vision or a talk never blocks a find, a
  King hit, the void, the heart or the disk; talking never pauses walking.
  Nobody is stuck in the Hallway (`HALLWAY_MAX_S`).
- **Only memory.** What a program told a talker is kept in the hub, never
  journaled. No story change, no `.loom` edit, no new signal: `sync-show` is
  needed only for the maps and `descent.json`.
- **The words are served live** (`descent.json`, read like `credits.json`) so a
  sign-off edit needs no new APK. The APK and the map carry fallbacks.
- **Steps are synthesised on the router**, paced by a speed the server sends,
  so nothing crosses the wire per step.
- **Comfort stands.** No forced camera motion, no roll, nothing flashing faster
  than 3 Hz. Small and big change eye height only, eased over `ALICE_EASE_S`.
- **Surprises.** The guests' play help never describes the descent or the
  steps. `docs/help/play/19-house-workings.md` (performer-only) may.
- **No hints.** The words know nothing useful about the duck, the void, the
  heart, the disk or the patch bay (`house/test/descent.test.ts` greps them).
- **All new copy is `DRAFT w49`** (`SIGNOFF-w49.md`).
- **Nothing ships with this wave by itself.** It merges to master; the user
  decides when to ship (the show is 2026-10-31).

## C1. `@loom/house` (done in `oct31-w49/contract`; binding)

Read `house/src/descent.ts`, `house/src/footsteps.ts` and `house/src/models.ts`:
they are the API. In short:

```ts
// models.ts: 35 new PROP_MODELS, groups "home" | "studio" | "strange";
// roles "wood", "flame" (GLOW_ROLES = screen, alert, flame: drawn glowing).
// types.ts
Prop.from?: number;   // only there at this level and deeper; propSolid() is false
Prop.talk?: string;   // a talker id, or TALK_NONE; absent: by model
Assignment.descent?: number; Assignment.told?: Record<string, string>;
// buildHouseScene(house, { descent }): leaves out `from` above it (default 0)

// descent.ts
DESCENT_MAX, DESCENT_FILE, VISION_KINDS, VISION_FROM, VISION_S, TALKERS_AWAKE,
TALK_NEAR_M, TALK_LEAVE_M, HALLWAY_*, DOOR_AHEAD_M, ALICE_*, DESCENT_LATE_S
clampDescent(n); descentLevel(reinstalled); descentOf(assignment); descentLook(level);
descentPlan(seed, level): DescentBeat[]; dueBeat(plan, from, t): number;
validateDescent(raw); parseDescent(raw); talkerFor(script, prop);
wakeTalkers(house, script, level, seed): {prop, talker}[];
talkReach(house, feet, prop, radius?); faceAnchor(prop); doorSpot(house, feet, yaw);
openNode(talker, told); pickOption(talker, node, index);
fillLine(text, {name, visit}); pickLine(list, n);

// footsteps.ts
AudioConfig.footsteps?: {enabled?, reach?, gain?};
footstepsSettings(audio); walkerOutputs(audio, house, room, p);
walkersOf(audio, house, players): Walker[]; sameWalkers(a, b); surfaceOf(house, room);
stepPaceS(speed);  // FOOTSTEP_* constants
Walker { id, speed, surface: "floor"|"tile"|"grass", to: {speaker, db, muffled}[] }
WalkersFrame { seq, at, walkers }
```

The seed of a plan and a wake is the session id. `visit` in `fillLine` is
`reinstalled + 1`. Goldens: `house/test/golden/descent.json`, `models.json`.
`descent.json` (the show's) is copied to `reinstall/vr/house/descent.json` by
`pnpm house:sync`.

The levels, for reference:

| Level | Walk | Awake | Visions, added at this level |
|---|---|---|---|
| 0 | 1st | 0 | none: the clean game |
| 1 | 2nd | 1 | `flicker`, `follower`, `whisper` |
| 2 | 3rd | 2 | `tint`, `whiteduck`, `grin` |
| 3 | 4th | 3 | `dark`, `self`, `small`, `big`, `door` |
| 4 | 5th+ | 5 | the same, every ~22 s |

## C2. The visions (both games; each lane draws its own)

A beat fires when `dueBeat` says so, on the walk's clock (starting when the
intro ends; a walk with the intro off starts at the first play frame). Hold a
beat while: an escape is under way, a talk is open, a held / suspended walk, a
vision is still running (one at a time), the player is within 3 m of the
King, or in the Hallway. Lines are `pickLine(list, beat.n)` through `fillLine`,
caption + the device voice, never naming a speaker. The steady `descentLook`
is on for the whole walk.

| Vision | What the player gets | Duration |
|---|---|---|
| `flicker` | the lights dip and stutter (≤ 3 Hz) | `VISION_S` |
| `follower` | steps behind the player that stop when they stop; at the end, one step more | |
| `whisper` | a line for the level, from no direction | |
| `tint` | the light goes a wrong colour, eased in and out | |
| `whiteduck` | a pale Gerald ~6 m ahead, wrong quack, waddling off, fades, one line. Not the real duck: never findable | |
| `grin` | a floating smile ~2.5 m ahead at eye height, fades last, one line | |
| `dark` | nearly black but for ~3 m round the player, a growl somewhere behind | |
| `self` | a pale copy of the player's own avatar on the way ahead, stops, looks back, gone, one line | |
| `small`, `big` | eye height × `ALICE_SMALL` / `ALICE_BIG`, eased `ALICE_EASE_S` each way, one line. Poses, physics and reach stay the real ones | |
| `door` | The Hallway: below | waits `VISION_S`, then fades |

Skip a vision that can't be drawn (no standable spot, on `low`, a `self` with
no avatar) rather than delaying the rest.

**The Hallway.** `doorSpot` picks where a free-standing `door` model (black
leaf, a red slit under it) appears. Walking within `HALLWAY_DOOR_M` of it goes
through. The player is then in a pocket off the map: a dark corridor
`HALLWAY_WIDTH_M` × `HALLWAY_HEIGHT_M`, with one moving light on them, the far
door `HALLWAY_FAR_M` ahead. For `HALLWAY_RETREAT_S` the far door backs away at
`HALLWAY_RETREAT` × their pace, then stays. Lines `script.hallway.enter` on the
way in, one of `far` part way, `out` on leaving. Reaching the far door, or
`HALLWAY_MAX_S` in, or any session end, brings them back: at the door they
entered, facing away from it, with the door gone. **While in the pocket:** the
pose pump keeps sending the pose at the door (the server sees them stand
there), the void, the heart, pickups, the King and the find are all off, the
house, ghosts and trail are hidden, and voice and cams keep following the door's
room. A remap or a session end while inside restores the house first.

## C3. The server (lane `server`)

Files: `core/server/spatial.ts`, `core/server/audio.ts`,
`core/server/event-runtime.ts`, a new `core/server/descent.ts`,
`core/scripts/sync-example.ts` (or wherever `credits.json` is replaced),
`core/scripts/loomcheck.ts`, `docs/loom-reinstall.md` §2, `core/CLAUDE.md`,
`core/README.md` (the route table), tests `core/test/w49-*.test.ts`.

### C3.1 Footsteps

- `SpatialHub` gains options `audio?: () => AudioConfig` and
  `onWalkers?: (walkers: Walker[]) => void`. Each session measures its speed
  from its pose over at least `FOOTSTEP_MEASURE_MS` (memory only). On every
  flush tick it runs `walkersOf` over joined, unfound, un-held sessions (room =
  the presence room) and calls `onWalkers` when `sameWalkers` is false, at most
  every `FOOTSTEPS_MIN_MS` (trailing edge kept), and when the last one stops.
  An escape's teleport never reads as a walk. `active` stays true until the
  walkers are empty.
- `AudioHub.setWalkers(walkers)` bumps a seq and tells its stream subscribers.
- `GET /api/mod/audio/walkers`: a server-sent stream of `walkers` events, each a
  `WalkersFrame`. One on connect; on every change; and every
  `FOOTSTEPS_KEEP_MS` while anyone walks. A mod token (query or header, as
  `/events`); never on the host allowlist.
- `POST /api/mod/audio/walkers/test {speaker}` → `{ok}`: a walker on that
  speaker alone at 0 dB, 1.4 m/s, for `FOOTSTEP_TEST_MS`, merged into the frames
  as id `test`. 404 for an unknown speaker. Memory only.

### C3.2 The script

- `core/server/descent.ts`: `DescentSource`, as `CreditsSource`: the project's
  `descent.json`, else `LOOM_DESCENT`, else with no project the scenario's own;
  cached 5 s; an invalid file reads as none, logged once. Reuse or generalise
  `credits.ts` if that is cleaner.
- `GET /api/spatial/descent` (a session token, as `/api/spatial/house`) →
  `{script: DescentScript | null}`.
- `sync-show` / `sync-example` always replace the project's `descent.json`
  (like `credits.json`). `loomcheck` lints it with `validateDescent`.

### C3.3 The level and what was told

- `assignmentOf` carries `descent` (`SpatialHub.descentFor(guest)`: the forced
  level, else `descentLevel(reinstalled)`) and `told`.
- `POST /api/spatial/told {talker, mark}` (a session token) → `{ok}`: remembers
  `told[guest][talker] = mark` (both strings ≤ 64). Never journaled; a story
  reset forgets it.
- `GET /api/mod/spatial/descent` → `{forced: number | null}`; `POST
  /api/mod/spatial/descent {level: 0..4 | null}` → `{ok, forced}`. On the host
  allowlist: no. A story reset clears it. It applies to the next deal, never a
  walk under way.

Old clients ignore the new fields. An old server gives neither `descent` nor the
script: the games read `reinstalled` and play the visions with no words (the web
game), or use the bundled script (VR).

## C4. stagehand (lane `stagehand`)

Files: `stagehand/src/stagehand/audio/footsteps.py` (new), `audio/module.py`,
`audio/mixer.py` (a strip), `stagehand/tests/`, `stagehand/README.md`.

- `FootstepBank`: synthesised at the device rate with numpy, seeded, no files:
  at least 6 takes each of `floor`, `tile`, `grass`, each take a heel thump
  (a decaying ~80 Hz sine) plus a short band-passed scuff, and a **muffled**
  copy of each (low-passed around 400 Hz, for `muffled` outputs). A file
  `<sounds_dir>/footstep_<surface>_<n>.wav` outranks a take if it exists.
- `Walkers`: `apply(frame)` and `tick(now)`, pure of asyncio and of the device
  (a fake mixer in tests). One walker's steps alternate takes, never the same
  twice running, every `stepPaceS(speed)` seconds with ±8 % jitter (a Python
  mirror of `stepPaceS`, pinned by a test against the constants). Each step is
  one or two `mixer.play` voices: the clear outputs, the muffled outputs, per
  speaker gain from `db` plus the file's trims (`output_gains`). A walker gone
  from the frame stops after its current step. No frame for
  `FOOTSTEPS_STALE_MS`: everyone stops.
- `_walkers_loop`: `run_stream` on `/api/mod/audio/walkers`, as `_feed_loop`. A
  404 (an older server) is logged once, and the loop stops until a restart.
- **The mix.** A new strip and source `steps` (`MIX_BUS_SOURCES`, label
  "Footsteps", on the `sfx` bus, ducked like sfx; `core/src/house-mixer.ts` is
  this lane's). `STRIPS`, `MIXED` and `effectiveDb`'s mirror follow, with the
  shared fixture.
- `show`'s and `lights`' jobs are untouched. On the Desktop this needs only
  `start-stagehand.ps1 -Restart audio`.

## C5. The web game (lane `web`)

Files: `reinstall/web/src/game/**`, `reinstall/web/src/spatial.ts`,
`reinstall/web/src/api.ts`, `reinstall/web/src/config.ts`, the map editor's
`props.ts`, `Toolbar.tsx`, `Inspector.tsx`, `AudioPanel.tsx`, `check.ts`,
`Canvas.tsx`, `house/src/three/` (additive), tests, `reinstall/web/README.md`,
`docs/loom-reinstall.md` §3, `docs/help/authoring/39-house-map.md`.
`MapApp.tsx` is lane `editor`'s: only touch it if you must, one small hunk.

- `game/descent.ts`: pure (node-tested): the runner over `descentPlan` +
  `dueBeat`, the holds, the talk state machine over `openNode` / `pickOption`.
- `game/visions.ts`: the three.js half, every vision of C2 and the talkers'
  faces (two eyes that follow the player and a mouth on `faceAnchor`, drawn only
  within ~8 m). `game/Talk.tsx`: the dialogue: the Win98 `Window`, the lines
  through `LinePlayer`, up to four buttons, keys 1–4, a tap on touch; it must
  not take the keyboard's movement keys. `game/hallway.ts`: the pocket, a
  one-room map through `buildPhysicsWorld` if that's simplest.
- `POST /api/spatial/told` on a `tell`. `GET /api/spatial/descent` at the start of
  a walk, never blocking it; a failure means no words.
- `?descent=N` (dev and rehearsal): overrides the level on this device.
  `Assignment.reinstalled` still drives the intro's skip.
- `low` keeps every vision that's cheap. No new point lights: the pool is fixed.
  Build still targets `chrome87` / `safari14`; `scripts/accept/K-14.sh` passes.
- **The map editor:** model groups Home, Studio and Strange (`MODEL_GROUP_LABELS`);
  in the inspector a prop's **Appears** select (Always, from level 1…4, which also
  clears `solid`) and **Talks** select (by model, a talker id, never: from the
  script when the event has one, else free text); a `from` prop drawn dashed on
  the plan; `check.ts` warns about a `Prop.talk` naming no talker. In the Audio
  tab, a **👣 Footsteps** block (on, reach, level) and a 👣 Test on a speaker's
  inspector (`/api/mod/audio/walkers/test`).

## C6. The VR game (lane `vr`)

Files: `reinstall/vr/**` (GDScript only), `reinstall/vr/test/`,
`reinstall/vr/README.md`, `docs/loom-reinstall.md` §5.

- `house/house_models.gd`: the literal port of the new models and roles
  (`wood`, `flame`), green against `models.json`. `HouseBuilder`: a `from` prop is
  built apart and shown only at its level (the house is built before the
  assignment: toggle it, don't rebuild).
- `house/house_descent.gd`: the literal port of `descent.ts`, green against
  `descent.json`. `HouseGeometry.prop_solid` honours `from`.
- `game/descent.gd` (the runner and every vision of C2; `follower` and the growl
  in `sfx.gd`; `self` from `ghosts.gd`'s avatar), `game/talk_panel.gd` (the
  dialogue), `game/hallway.gd` (the pocket). Follow `_tick_escape`'s shape: an early
  return in `_tick_play`, poses still sent, at the door.
- **Dialogue.** Lines go through `Speech.say` with the prop as the anchor. Options
  are a world panel near the prop, turned to the player, one plain row per option,
  chosen with `LobbyPointer`: the beam shows only while a panel is open, the row
  under it highlights, the trigger picks. A trigger on a row never hits the King.
  Walking away (`TALK_LEAVE_M`) ends the talk. Non-XR and tests go through
  `pointer.inject`.
- `small` / `big`: `XROrigin3D.world_scale` in XR (eased), the camera's height
  otherwise. The body's capsule, poses and reach don't change.
- `server_link.gd`: `fetch_descent()` at the walk's start, falling back on
  `res://house/descent.json`; `post_told(talker, mark)`; `Assignment.descent`.
  `config.gd` gains `--descent N` (and `descent` in `station.json`, default unset).
  The lobby's offline test level (`test_combo.gd`) gets a second combo, the mirror
  `AABBABABBAA`, that plays at level 4.
- Quest 3 must hold its frame rate on `medium`: no shadows, no new omni lights past
  the ≤ 8 rule (a vision re-uses the pool or an unshaded mesh), meshes shared, built
  once at walk start.
- The autopilot ignores all of it: talks and visions never block it.
  `pnpm test:vr` stays green with new checks for the port, the runner and the panel.

## C7. The editor (lane `editor`)

Files: `reinstall/web/src/map/MapApp.tsx` (split), `unlock.ts`, a new
`reinstall/web/src/map/embed.tsx`, `reinstall/web/src/main.tsx`, `editor/**`,
`editor/CLAUDE.md`, `docs/help/authoring/` (39, 47, 33), `reinstall/CLAUDE.md`.

- **🗺 Map** is a fifth view of Run → House (`store/house-view.ts`): the real map
  editor, mounted in a shadow root like `@loom/play/embed`, lazily (its own chunk;
  the editor's first load must not grow by three.js).
- Split `MapEditor` out of `MapApp.tsx` so the embed needs neither `Setup` nor the
  game. `embed.tsx` exports `MapEmbed({eventId, token, title})`, bringing its CSS in
  with `?inline` and the fonts it needs.
- The auth: the Run's `codes.mod` → `/api/mod/login` → the token, in `ReinstallConfig`,
  with no passcode dialog (`MapUnlock` opened: the author's session is the unlock).
- Inside a shadow root `e.target` is the host at the window: the map's window key
  handler and `isTyping` must read `e.composedPath()[0]`, and it must not take keys
  while the House tab isn't showing the map. Keys handled inside the map must not
  also reach the editor's shell keys.
- `window.confirm` works in a browser. In the Tauri shell (`isDesktop()`) it returns
  false: there, show *Open in browser* instead of the embed.
- Beside the embed, **Open in a new tab ↗**: `/reinstall/map?code=<mod>`.
- Ways in: the Run page's House map card gets **🗺 Edit the map**, opening Run → House
  → Map; the command palette gets *Open the house map*; a `house*.json` file open in
  Writing gets a one-line banner with the same button. With no run: it says to start
  a rehearsal.
- **The descent's select** on the House map card: *Descent: by visits / 0 / 1 / 2 / 3 / 4*
  (`/api/mod/spatial/descent`). Hidden on an old server (404).
- Every doc that sends a director to `/reinstall/map` now says Run → House → 🗺 Map.

## C8. Docs and copy (lane `contract`)

`SIGNOFF-w49.md`, `docs/help/play/19-house-workings.md`, `reinstall/CLAUDE.md`,
`house/CLAUDE.md`, root `CLAUDE.md`, the show's `INDEX.md`, `SHOW.html` regenerated.
