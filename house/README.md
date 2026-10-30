# @loom/house

The house map for *Trapped in the Internet*'s reinstallation games: one
coordinate frame shared by the VR game (`reinstall/vr`, Godot), the web game
(`reinstall/web`), the event server's `SpatialHub` and the wall terminals.
It also holds the house speakers (`audio.json`), the house lights
(`lights.json`) and the voice link's wire rules, which are placed in the
same frame but never live in the map. Pure TypeScript, no dependencies, no
`node:` imports — it runs on the server and in the browser. The normative
contract is [`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §1 (map,
speakers, lights) and §2.4 (voice). Agents: see [`CLAUDE.md`](./CLAUDE.md).

**The frame.** Metres, right-handed, **Y up**: `+x` east, `+y` up, `+z`
**south** (north is `−z`). A plan point is `[x, z]`. Yaw is degrees about
`+y`, `0` = facing north, positive = turning left (counter-clockwise seen
from above) — three.js's and Godot's `rotation.y`. Every pose on the wire is
in this frame; a game with its own world frame converts through
`spaces.<name>` (`toSpace` / `fromSpace`).

| Module | What |
|---|---|
| `types.ts` | `HouseMap` schema v1 and the wire types (`Assignment`, `PlayerState`, `SpatialCandidate`, `SpatialFrames`, `FoundResult`, `KingState`, …). `PropKind` includes `king` (the shared King: `hp` = his maximum, `health` = the story world path holding his current points, `signals` won / lost / drawn / hit / fallen, `armed`), and since wave 26 `heart` (Trabolta's heart, `signals.reached`) and `pickup` (`item`, `signals.taken`); a `Door.guard` names the king who keeps it shut. `Assignment` carries `kingHit`, `picked` and `heartHeard`. A `TerminalSpot` carries an optional `view`, `speaks` and `voice`. `PlayerState`, `Assignment` and `SpatialCandidate` carry `avatar` (the profile picture's key); candidates carry `captured`, `restricted` and `eligible`; `LeaveReason` includes `unmarked` |
| `clone.ts` | `cloneData(v)` — a deep copy of plain data: `structuredClone` where the runtime has it, else a JSON round trip (old tablets' WebViews predate Chrome 98). Use it instead of `structuredClone` in anything a tablet loads |
| `validate.ts` | `validateHouse(raw)` → `{ok, problems, house?}`; `normalizeHouse`. Beyond plan containment it checks heights (duck spot 0–`DUCK_MAX_RISE` above its room's floor, spawn within `STEP_UP`, terminal/prop within the room's storey, duck/spawn `locate` to their own room and not buried in a solid prop), floor spacing (> `FLOOR_SLACK`), walls rising through the floor above, stair head/foot clearance + no skipped floor + 1 mm rects + no stairwell stacked flight over flight (rects overlapping in plan on a shared floor), `b = null` doors on shared walls, overlapping door gaps, a door's `guard` (must name a `king` prop standing in one of the door's rooms), a king's `hp` (an integer 1–`KING_MAX_HP` 99), `health` (a world path such as `Night.king_hp`) and `armed` on anything but a king; `signals` keys per kind (`PROP_SIGNAL_KEYS`: a king's five, a heart's `reached`, a pickup's `taken`, none elsewhere); a pickup's required `item` (refused elsewhere) and no `label` on a heart or a pickup (an old game would draw it). `guardWarnings(house)` is advice, not a refusal (a guard more than `GUARD_REACH` from his door); the server's `houseWarnings` folds it in |
| `geometry.ts` | `buildWalls` (normative, golden-tested), `buildFloors`, `buildRamps`, `doorGap` (the segment a door's gap is — the games stand a closed leaf in a guarded one), `propSolid` (box / cylinder / king; never a heart or a pickup unless `solid`), plan helpers |
| `locate.ts` | `floorOf`, `roomAt`, `locate` (with the stair rule), `heightAt`; `solidPropAt` (the buried-in-a-solid-prop rule `validateHouse` uses) and `standable` (in a room, over a surface, not buried — props ≤ `PROP_STEP_OVER` stepped over): the re-seat rule after a remap — the server and both games put a player who isn't standable on a new map back at its spawn (`docs/loom-reinstall.md` §2.2); the locate goldens carry it |
| `route.ts` | `portals`, `route` (visibility-graph Dijkstra through doors + stairs, round reflex corners, stair holes and solid props — `roomObstacles`, `propObstacle`, `PROP_MARGIN`; a guarded door is shut: never a portal; `route(house, from, to, {fallen})` routes over `withFallenKings`, those kings' doors open), `sampleTrail`; `PATH_REVEAL_MS` 60 000 (wave 26, R2: the games hide the path to Gerald for a session's first minute) |
| `king.ts` | the shared King (wave 11): `kingReach(house, feet, yaw, king, slack?)` → `"ok" \| "floor" \| "far" \| "facing"` (the rule both games and the server judge a hit by; `KING_REACH` 1.25 m, `KING_CONE_DEG` 55°, the server's `KING_HIT_SLACK` +0.35 m / +25°), `kingProps`, `kingMax` (`hp`, default `KING_HP` 4), `kingSignal` (`KING_SIGNALS` defaults `chess won` … `king fallen`), `kingStateOf(king, raw)` (a missing or non-number value reads as full), `guardedDoors`, `withFallenKings(house, fallen)` (a copy: the fallen kings' doors unguarded, the kings not solid) |
| `escape.ts` | the void (wave 26, R4): `outsideGround(house)` → `{floor, y, rect}` (the floor an exterior door opens from, the bounds of its rooms grown by `OUTSIDE_GROUND_MARGIN` 30 — VR's ground), `voidDistance(house, p)` (null in a room, else the plan distance to the nearest room on its floor), `ESCAPE_M` 5, `ESCAPE_SLACK` 0.5, `ESCAPE_COOLDOWN_MS` 20 000, `ESCAPE_SIGNAL` |
| `presence.ts` | presence (wave 26, R5): `presenceRoom(house, p, prev)` (`locate`'s room, but `prev` holds inside its polygon, within `PRESENCE_HYSTERESIS_M` 0.75 m of the gap of a door joining it to the new room or the outside, or over a stair joining them; never through a solid wall), `linkedSpots(house, rooms)` (the terminals in those rooms, never a `view: "reinstall"` one), `PRESENCE_LINGER_MS` 3000 (a client-side latch) |
| `descent.ts` | the descent (wave 49): `descentLevel`, `descentOf`, `descentLook`, the seeded `descentPlan` + `dueBeat`, the `descent.json` schema (`validateDescent`), who wakes (`talkerFor`, `wakeTalkers`), `talkReach`, `faceAnchor`, `doorSpot`, how a talk walks (`openNode`, `pickOption`), `fillLine`, `pickLine` |
| `footsteps.ts` | footsteps in the real house (wave 49): `walkerOutputs`, `walkersOf`, `sameWalkers`, `surfaceOf`, `stepPaceS`, `footstepsSettings` over `audio.json`'s `footsteps` block |
| `moment.ts` | the heart and the pickup (wave 26, C6): `heartReached(house, feet, heart)` (its room, ≥ `HEART_INSET_M` 0.3 inside), `pickupReach(house, feet, prop, slack?)` (same floor, within `DUCK_MAX_RISE`, `PICKUP_REACH_M` 0.9 + slack; the server's `PICKUP_SLACK_M` 0.3), `momentProp(house, id, kind)`, `heartProps`, `pickupProps`, `propSignal(prop)` (`HEART_SIGNAL` / `PICKUP_SIGNAL` defaults) |
| `models.ts` | prop models (wave 47): `PROP_MODELS` (23: walls, cabinets, shelves, desks, server racks, a mainframe, CRTs, workstations, a video wall, an error dialog, a security camera, chairs, a water cooler, a plastic plant, …), `modelParts(prop)` / `partsOf(id, w, h, d)` (boxes and cylinders by role: body, trim, dark, neon, screen, glass, leaf, alert), `modelBodyColor` / `modelNeonColor`; and the games' neon and haze numbers (`NEON_*`, `HAZE_*`, `neonFlicker(t)`). Drawing only: a model prop collides as its plain shape. Golden: `test/golden/models.json` |
| `frames.ts` | `toSpace` / `fromSpace` / `yawToSpace` / `yawFromSpace`, `forward`; `DEFAULT_SPOT_FOV` (70, vertical) + `horizontalFov(vfovDeg, aspect = TABLET_ASPECT = 16/10)` for terminal cameras |
| `duck.ts` | `fnv1a32`, `pickDuckSpot`, `houseHash` |
| `audio.ts` | the house speakers: `AudioConfig` v1 (`audio.json`: the device incl. `expect {inputs, outputs}`, inputs, outputs, speakers on a room + `pos` / `yaw` / `out[]` / `gain`, zones, the sparse `routes` matrix, `cues`, `announce` incl. `announce.terminals`, `voice.tv`; since wave 38 an input's optional `role` (the priority source it drives: `trabolta`, `clippy`; `AUDIO_ROLE_PATTERN`, never one of `AUDIO_RESERVED_ROLES` `announce` / `takeover`; `AUDIO_KNOWN_ROLES` are the editor's names) and `reach` (the targets it ducks; default the outputs its routes feed, else everywhere)), `validateAudio(audio, house?)` (problems + warnings), `resolveTargets` (everywhere / zone / room / LOCATION / speaker id), `audioHash`, `defaultAudio` |
| `look-edit.ts` | (wave 30) editing a look: names, targets, steps with Zigbee-safe spacing (`minStepAt`), how it ends (`setLookMode`, a period that always wraps safely), the boot look, `lookProblems`, `lookCoverage`. Moved from the map editor so the editor's Cue designer shares it |
| `look-preview.ts` | (wave 30) `previewAt(plan, fixtures, t)`: each lamp's brightness and colour at a moment, fading over `transition`, the repeats, the loop, a restore; `previewLength`, `lampCss`, `miredsToHex` |
| `look-templates.ts` | (wave 30) `lookFromTemplate(t, {to, color, color2, speed, floor})`: fade, pulse, heartbeat, flash, flicker, cycle, alarm, work, blackout, each valid for any fixture; `lookFloor` |
| `lights.ts` | the house lights: `LightsConfig` v1 (`lights.json`: fixtures `zigbee` / `zigbee-group` / `wled` with caps, `safety` + `min` ≥ `LIGHT_SAFETY_MIN` 40, zones, looks keyed by the story's cue name (never one starting with a `LIGHT_RESERVED_PREFIXES` prefix: `screens_`, `terminals_`, `tv_`, `tablet_`, `room_`, and since wave 38 `music_`) with `set` / `steps` / `repeat` / `loop` / `period` / `then: "restore"`, `boot`), `validateLights`, `resolveLightTargets`, `planLook`, `clampForSafety`, `z2mPayload` / `wledPayload`, `lightsHash` |
| `voice.ts` | the voice link's wire: `VOICE_RATE` 16 000, `VOICE_CHUNK_MS` 200, G.711 μ-law (`mulawEncode` / `mulawDecode`), `resample`, `rmsDbfs`, `VoiceGate` (−42 dBFS gate, −28 dBFS barge-in), `jitterPlan`, and the one routing rule `hearsTerminals` / `hearsPlayers`: same room only (wave 26) — the player's `room` (the server passes the presence room, else `locate`'s) equals the terminal's, gain 1, the 4 / 3 nearest, never a `view: "reinstall"` terminal (the tent, even with `voice: true`); no reach, nothing through a wall, the doorway hysteresis is `presenceRoom`'s; `only` limits the candidates |
| `voice-on.ts` | `voiceOn(house, spot)` (a spot's `voice`, unset = off in the spawn room) — its own subpath, `@loom/house/voice-on`, so a terminal can ask without loading the codec |
| `three/` | `@loom/house/three` — the three.js scene builder (peer dep `three`) |

The show's map is `core/examples/trapped-in-the-internet/house.json`,
drawn from the real house in the map editor (2026-10-20): three floors
(basement, main, top) plus the backyard with the tent, 17 rooms, 14
terminal spots, the King guarding the server-room door, Trabolta's heart
(`server-heart`) in the Server Room and the virus disk (`virus-disk`,
`item: "virus"`) in the Hard Drive, over 2 m from every duck spot and off
every trail (wave 26). Its rain variant
`house.shed.json` puts The Internet in the shed (the tent spot and the
spawn move there). Both are checked by `test/show.test.ts` +
`test/route.test.ts`; only `house.json` has goldens. The older placeholder
maps are frozen in `test/maps/` for the tests that pin them. The speakers
and lights sit beside the maps as `audio.json` and `lights.json`; their
shared fixtures (`test/fixtures/audio-*.json`, `lights-*.json`) also pin
stagehand's Python mirrors (`stagehand/tests/test_audio_routing.py`,
`test_lights_routing.py`).

```bash
pnpm --filter @loom/house test        # vitest (validation, walls, locate, route, the King, the void, presence, moments, audio, lights, voice, three, goldens, sync) — 419 + 4 skipped, 19 files
pnpm --filter @loom/house typecheck
pnpm --filter @loom/house goldens     # regenerate test/golden/ after a deliberate change, then commit
pnpm --filter @loom/house sync        # copy house.json, the goldens and the voice vectors into reinstall/vr/ (a test fails on drift)
pnpm house:sync                       # from the repo root: goldens + sync in one go
```

Golden files (`test/golden/<map>.{walls,routes,locate}.json`, one per
fixture in `test/fixtures/` plus `show`) are what the GDScript port is
diffed against; queries are stored with their answers. A map with a king
also gets `<map>.king.json` (`kingReach` round each king: 8 bearings,
several distances and facings, with and without the server's slack) and
`<map>.fallen.json` (the route queries again with every king fallen):
today only `show` has them. Wave 26 adds `<map>.escape.json`
(`outsideGround` + `voidDistance`), `<map>.presence.json` (`presenceRoom`
either side of every door, `linkedSpots`), `<map>.moments.json` on a map
with a heart or a pickup (`heartReached`, `pickupReach` plain and with
the slack; only `show`), and `constants.json` (every new constant the
ports carry).

## `@loom/house/three` — the scene builder

`src/three/` (peer dependency `three`) turns a map into a three.js scene.
The web game and the terminals' world view both render through it, so they
always look alike. It has no React and touches almost no DOM: everything
constructs under node without WebGL. Only creating the `WebGLRenderer` is
the app's job. The house frame *is* three's frame, so geometry goes in
unchanged. Yaw is `rotation.y` in degrees.

| Export | What |
|---|---|
| `buildHouseScene(house, opts?)` | `{root, floors, terminals, labels, ceilings, walls, update(dt, camera?), dispose()}` (more below) |
| `houseAtmosphere(scene)` | a deep-navy background with fog to match |
| `createDuck()` | Gerald: `{object, update(dt, t?), layEgg(), reset(), state, dispose()}`. `layEgg()` resolves `DUCK_FLIGHT` (2.5 s) of `update` time later. |
| `createTrail()` | `{object, set(route), update(dt), points, dispose()}`. Golden chevrons every 0.75 m on one `InstancedMesh`, with a pulse running toward the duck. |
| `createKing(prop)` | the King (`king.ts`): a gold body with a crown and a Win98 health-bar sprite — `setHp(hp, max)` (a cell per point up to `BAR_CELLS_MAX` nine, else one fill reading *n / max*), `hit()` (a stagger, `KING_STAGGER` s; ignored while he kneels), `kneel(on)` (down on one knee over `KING_KNEEL` s, lower and bowed, crown kept; `kneel(false)` stands him back up), `reset()`, `update(dt, camera?)`. `buildHouseScene` makes one per `king` prop (`kings`) and stands a closed leaf in every guarded door (`doors`; `kings: false` skips both). `HouseScene.showKing(id, {hp, max, fallen}, open?)` shows the server's shared `KingState`: the bar, the kneel, and his doors' leaves hidden while `open` (default: while fallen). The web game and the terminals both call it |
| `createHeart(prop?)` | Trabolta's heart (wave 26, `heart.ts`): a dark rack with a core that beats a slow lub-dub every `HEART_BEAT_S` (1.2 s; `heartPulse(t)`), no labels, rows or coloured lights. `buildHouseScene` always builds one per `heart` prop (`hearts`), visible only once every King on the map has fallen (or the map has none) — `showKing` drives it |
| `createPickup(item)` | a pickup (wave 26, `pickup.ts`): a 3.5" floppy, sized up, spinning and bobbing `PICKUP_HOVER` (0.75 m) over its spot with a sickly green glow. Drawn only with `buildHouseScene(…, {pickups: true})` (`pickups`; the games pass it, the terminals and the map editor don't); `HouseScene.setPickupTaken(id, taken)` hides one for this viewer |
| `createAvatar(name, seed, {picture?})` | a ghost: `{object, tag, picture, setPicture(url), setPose(p, yaw, pitch), update(dt), dispose()}`. `p` is the feet, as on the wire. With a picture (the guest's `/e/<id>/api/avatar/<key>`) the ghost wears it as a billboard Win98 tile head over the capsule (`PICTURE_SIZE` 0.42 m) and as the tag's icon; with none, or one that won't load, the plain tinted capsule |
| `loadPicture(url)` | the picture cache behind it (`picture.ts`): drawn contain-fit on a fixed `PICTURE_PX` (128) canvas, so an SVG with no intrinsic size still renders; one texture per URL for the page's lifetime, never freed by an avatar; a failure resolves null and is remembered for `PICTURE_RETRY_MS` (60 s), then tried once more |
| `PoseBuffer` | pure pose interpolation. `push(t, pose)` / `sample(t)` render `delay` (120) behind, with linear `p`, shortest-arc yaw, and extrapolation that is span-floored (`minSpan` 100, so frames delivered in one chunk can't fling the ghost), capped (`maxLead` 0.3 m, `maxTurn` 30°) and eased back onto the newest sample, so a player who stopped is drawn exactly where they stand. |
| `spaceGroup(t)` / `applySpace` | `spaces.<name>` as a parent group (`T · R · S` = `Ry(yaw) · scale · house + offset`) |
| `wallBoxes`, `trailPoints`, `labelPoint` | the pure placement maths, tested without three |

What `buildHouseScene` returns:

- `root` holds one group per floor (`floors`).
- Each floor group has one merged mesh per material: walls, lintels, fences, rails, floors with their ramps, ceilings, props and prop screens, plus edge lines on the walls.
- Terminal screens sit at each `TerminalSpot`. A screen faces the spot's yaw/pitch, stands just proud of the wall and shows an animated "watching" eye.
- Room labels are Win98 title bars hung under the ceiling. They fade out within about 2.5 m of the `camera` passed to `update`.
- `walls` is the `buildWalls` output the meshes came from. Use it for collision.
- `hearts` and `pickups` (wave 26, above); `ground` is a dark plane with a faint metre grid at `outsideGround`, a hair under the floors, with every room on its floor cut out of it (VR's `HouseGeometry.cells`, so a stairwell shows the stairs), with `ground: true` (the games), else null.
- `dispose()` frees every geometry, material and texture.

The look is late-90s Windows: a teal desktop on the walls, checkerboard
floors tinted by `room.color`, starfield ceilings, "under construction"
stripes on the rails, picket fences, bevelled lintels and flat Lambert/Basic
materials. Every texture is a small canvas drawn at runtime, because the
apps' CSP forbids external assets. Without a `document`, the textures fall
back to plain colours and labels and name tags are skipped (`hasDom()`).

## Constants a port must match

Every engine port (`reinstall/vr/house/*.gd`) and every consumer uses these
exported values, not its own copies (§1.1 / §1.2 / §2.1 of the contract):

| Constant | Value | Used by |
|---|---|---|
| `DOOR_TOLERANCE` | 0.02 m, against the wall's **mm-rounded** line | `buildWalls` step 5 + `validateHouse` (a validated door is always cut) |
| `FLOOR_SLACK` / `STEP_UP` | 0.5 m / 0.45 m | `floorOf`, `heightAt`; floors closer than `FLOOR_SLACK` are refused |
| `ROUTE_CLEARANCE` / `OBSTACLE_SHRINK` / `ROUTE_EPS` | 0.35 m / 0.01 m / 1e-6 | `route` waypoints, stair obstacles, the one tolerance |
| `PROP_MARGIN` | 0.25 m (the walker's radius) | solid-prop obstacles, rounded to µm (`um`) |
| `DUCK_MAX_RISE` | 1.2 m | duck-spot validation, the server's `nearDuck`, both games' reach rule |
| `DEFAULT_SPOT_FOV` / `TABLET_ASPECT` | 70° vertical / 16:10 | terminal mount cameras; `horizontalFov` for plan cones |
| `GUARD_REACH` | 1.0 m (plan) | `guardWarnings`: a door's guard standing further than this from the door's point is not in the doorway |
| `KING_REACH` / `KING_CONE_DEG` | 1.25 m (plan, feet → his base centre) / 55° | `kingReach`: both games' pre-check, the server's hit (plus `KING_HIT_SLACK` +0.35 m / +25°), the `king` goldens |
| `KING_MAX_HP` / `KING_HP` | 99 / 4 | a king's largest `hp`; his maximum when the prop declares none |
| `ESCAPE_M` / `ESCAPE_SLACK` / `ESCAPE_COOLDOWN_MS` | 5 m / 0.5 m / 20 s | the void: both games' trigger, the server's check, one escape per session per cooldown |
| `OUTSIDE_GROUND_MARGIN` | 30 m | `outsideGround` = VR's `GROUND_MARGIN` |
| `PRESENCE_HYSTERESIS_M` / `PRESENCE_LINGER_MS` | 0.75 m / 3 s | `presenceRoom`'s doorway hold (from the door gap); a client's link latch |
| `PATH_REVEAL_MS` | 60 s | both games hide the path to Gerald for a session's first minute |
| `HEART_INSET_M` / `PICKUP_REACH_M` / `PICKUP_SLACK_M` | 0.3 m / 0.9 m / 0.3 m | `heartReached`, `pickupReach` (the server adds the slack) |
| `ESCAPE_SIGNAL` / `HEART_SIGNAL` / `PICKUP_SIGNAL` | "simulation escape attempt" / "simulation heart reached" / "simulation pickup taken" | the moment route's story signals (a prop's own `signals.reached` / `taken` wins) |
