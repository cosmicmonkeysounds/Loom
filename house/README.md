# @loom/house

The house map for *Trapped in the Internet*'s reinstallation games: one
coordinate frame shared by the VR game (`reinstall/vr`, Godot), the web game
(`reinstall/web`), the event server's `SpatialHub` and the wall terminals.
Pure TypeScript, no dependencies, no `node:` imports — it runs on the server
and in the browser. The normative contract is
[`docs/loom-reinstall.md`](../docs/loom-reinstall.md) §1.

**The frame.** Metres, right-handed, **Y up**: `+x` east, `+y` up, `+z`
**south** (north is `−z`). A plan point is `[x, z]`. Yaw is degrees about
`+y`, `0` = facing north, positive = turning left (counter-clockwise seen
from above) — three.js's and Godot's `rotation.y`. Every pose on the wire is
in this frame; a game with its own world frame converts through
`spaces.<name>` (`toSpace` / `fromSpace`).

| Module | What |
|---|---|
| `types.ts` | `HouseMap` schema v1 + the wire types (`Assignment`, `PlayerState`, `SpatialFrames`, …) |
| `clone.ts` | `cloneData(v)` — a deep copy of plain data: `structuredClone` where the runtime has it, else a JSON round trip (old tablets' WebViews predate Chrome 98). Use it instead of `structuredClone` in anything a tablet loads |
| `validate.ts` | `validateHouse(raw)` → `{ok, problems, house?}`; `normalizeHouse`. Beyond plan containment it checks heights (duck spot 0–`DUCK_MAX_RISE` above its room's floor, spawn within `STEP_UP`, terminal/prop within the room's storey, duck/spawn `locate` to their own room and not buried in a solid prop), floor spacing (> `FLOOR_SLACK`), walls rising through the floor above, stair head/foot clearance + no skipped floor + 1 mm rects + no stairwell stacked flight over flight (rects overlapping in plan on a shared floor), `b = null` doors on shared walls, and overlapping door gaps |
| `geometry.ts` | `buildWalls` (normative, golden-tested), `buildFloors`, `buildRamps`, plan helpers |
| `locate.ts` | `floorOf`, `roomAt`, `locate` (with the stair rule), `heightAt` |
| `route.ts` | `portals`, `route` (visibility-graph Dijkstra through doors + stairs, round reflex corners, stair holes and solid props — `roomObstacles`, `propObstacle`, `PROP_MARGIN`), `sampleTrail` |
| `frames.ts` | `toSpace` / `fromSpace` / `yawToSpace` / `yawFromSpace`, `forward`; `DEFAULT_SPOT_FOV` (70, vertical) + `horizontalFov(vfovDeg, aspect = TABLET_ASPECT = 16/10)` for terminal cameras |
| `duck.ts` | `fnv1a32`, `pickDuckSpot`, `houseHash` |
| `three/` | `@loom/house/three` — the three.js scene builder (peer dep `three`) |

The show's map is `core/examples/trapped-in-the-internet/house.json` (a
placeholder layout until the house is measured).

```bash
pnpm --filter @loom/house test        # vitest (validation, hand-computed walls, locate, route, goldens, sync)
pnpm --filter @loom/house typecheck
pnpm --filter @loom/house goldens     # regenerate test/golden/ after a deliberate change, then commit
pnpm --filter @loom/house sync        # copy house.json + goldens into reinstall/vr/ (a test fails on drift)
```

Golden files (`test/golden/<map>.{walls,routes,locate}.json`, one per
fixture in `test/fixtures/` plus `show`) are what the GDScript port is
diffed against; queries are stored with their answers.

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
| `createAvatar(name, seed)` | a ghost: `{object, tag, setPose(p, yaw, pitch), update(dt), dispose()}`. `p` is the feet, as on the wire. |
| `PoseBuffer` | pure pose interpolation. `push(t, pose)` / `sample(t)` render `delay` (120) behind, with linear `p`, shortest-arc yaw, and extrapolation that is span-floored (`minSpan` 100, so frames delivered in one chunk can't fling the ghost), capped (`maxLead` 0.3 m, `maxTurn` 30°) and eased back onto the newest sample, so a player who stopped is drawn exactly where they stand. |
| `spaceGroup(t)` / `applySpace` | `spaces.<name>` as a parent group (`T · R · S` = `Ry(yaw) · scale · house + offset`) |
| `wallBoxes`, `trailPoints`, `labelPoint` | the pure placement maths, tested without three |

What `buildHouseScene` returns:

- `root` holds one group per floor (`floors`).
- Each floor group has one merged mesh per material: walls, lintels, fences, rails, floors with their ramps, ceilings, props and prop screens, plus edge lines on the walls.
- Terminal screens sit at each `TerminalSpot`. A screen faces the spot's yaw/pitch, stands just proud of the wall and shows an animated "watching" eye.
- Room labels are Win98 title bars hung under the ceiling. They fade out within about 2.5 m of the `camera` passed to `update`.
- `walls` is the `buildWalls` output the meshes came from. Use it for collision.
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
