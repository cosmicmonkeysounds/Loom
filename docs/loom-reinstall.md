# Reinstallation — the golden-duck games and the spatial terminals

*Trapped in the Internet*, 2026-10. Status: **design contract** (this file
is normative for every piece below; when code and this file disagree, fix
one of them in the same change).

A program that the Antivirus drags into **The Internet** (the tent in the
backyard, through the tunnel) is *reinstalled* by proving, in a simulation, that it can follow
instructions: it explores a **virtual copy of the house** and finds the
**golden duck** (Gerald, gilded). Two games run the same simulation:

| Game | Where | Input | Code |
|---|---|---|---|
| **VR** | Quest 3 headset(s) in the tent | thumbsticks only: left stick walks (head-relative), right stick turns (snap 45°, or smooth) | `reinstall/vr/` — Godot 4.7 project, OpenXR |
| **Web** | a tablet (the tent tablet, or anywhere) | on-screen twin joysticks (touch) **and** keyboard (WASD/arrows walk, Q/E or ←/→ turn, mouse-drag look) | `reinstall/web/` — Vite + three.js app `loom-reinstall`, served at `/reinstall/` |

Both games stream the player's **pose** to the event server. Every
**terminal** (the wall tablets, `terminal/`) receives that stream and shows
the players exploring the virtual house — through a virtual window placed
exactly where the terminal hangs on the real wall.

```
 pass QR ──scan──▶ web game / tent tablet ──POST /api/mod/spatial/begin──┐
                                                                          ▼
 Quest 3 ──poll /api/mod/spatial/station──▶ assignment          SpatialHub (event server)
 Quest 3 / web ──POST /api/spatial/pose (10 Hz, house frame)──▶   │  ├─ journal: only the story outcome
 game ──POST /api/spatial/found──▶ signal "the simulation completed" + "the golden duck"
                                                                  ▼
 terminals ◀── SSE /api/spatial/stream (poses 10 Hz, hello/join/leave/found/house/duck/reset)
```

## 1. One house, one frame — `house.json`

The single source of spatial truth is a **house map**: a JSON document in
**house coordinates**. Both games *build their geometry procedurally from
it*, the server labels every pose with a room from it, and every terminal is
placed in it. That is how one real terminal maps into both virtual spaces at
once: there is only one frame.

**House frame.** Metres. Right-handed, **Y up**: `+x` = east, `+y` = up,
`+z` = **south** (so north is `−z`). The origin is a surveyed real point
(the show's: the front door's outside threshold, floor level, east jamb).
A **plan point** is `[x, z]`. **Yaw** is degrees about `+y`, `0` = facing
north (`−z`), positive = counter-clockwise seen from above (turning left,
toward west) — exactly three.js's and Godot's `rotation.y` for a camera or
node whose forward is `−z`. This supersedes the z-up sketch in
`loom-show-control.md` §"Coordinate contract".

**Spaces.** A game may render the house in its own world frame (e.g. a
scanned mesh someday). `spaces.<name>` gives the transform **house → space**:
`world = Ry(yaw) · (scale · house) + offset`. The procedural builders use
the identity, which is the default. **Every pose on the wire is in house
coordinates**; a game converts with its own space transform before sending
and after receiving.

### 1.1 Schema (version 1)

```ts
type Vec2 = [number, number];          // plan [x, z]
type Vec3 = [number, number, number];  // [x, y, z]

interface HouseMap {
  version: 1;
  name: string;                 // "Trapped in the Internet — the house"
  origin: string;               // human description of the surveyed origin
  variant?: string;             // the map page's variant button label ("Tent"); not geometry
  floors: Floor[];              // ≥ 1
  rooms: Room[];                // ≥ 1
  doors: Door[];
  stairs: Stair[];
  terminals: TerminalSpot[];
  duck: { spots: DuckSpot[] };  // ≥ 1
  spawn: { room: string; pos: Vec3; yaw: number };
  props: Prop[];
  spaces: Record<string, SpaceTransform>;   // "vr", "web"; missing = identity
  style?: { fence?: number; wallThickness?: number; doorHeight?: number };   // defaults 1.0 / 0.1 (rendering only) / 2.0
}
interface Floor  { id: string; label: string; elevation: number; height: number }
interface Room {
  id: string; label: string; floor: string;
  location?: string;            // the Loom LOCATION it is in the story ("The Start Bar")
  poly: Vec2[];                 // rectilinear (every edge axis-aligned), ≥ 4 vertices, simple, either winding
  height?: number;              // default: its floor's height
  outdoor?: boolean;            // no ceiling; unshared edges become a fence
  color?: string;               // "#rrggbb" — floor tint
}
interface Door { id: string; a: string; b: string | null; at: Vec2; width: number; height?: number; guard?: string }
//   a door is a gap in the wall between rooms a and b (b = null: to the outside) on a's floor;
//   `at` lies on the shared wall line (± 0.02 m). `guard` = the id of a "king" prop standing in
//   the doorway: the web game and the terminals stand a closed leaf in the gap (`doorGap`); every game keeps the door shut —
//   for walking and for `route` — until that king falls (§3 The King).
interface Stair { id: string; from: string; to: string; rect: [number, number, number, number]; up: "n" | "s" | "e" | "w" }
//   from = the lower room, to = the upper room; rect = [x0, z0, x1, z1] (plan, x0<x1, z0<z1),
//   inside both rooms' footprints. The ramp rises toward `up`: from `from`'s floor elevation at the
//   opposite edge to `to`'s floor elevation at the `up` edge. The rect is a hole in the upper floor
//   (and the lower room's ceiling); rails guard the hole on the upper floor on the three non-`up` sides.
interface TerminalSpot { id: string; name: string; room: string; pos: Vec3; yaw: number; pitch?: number; fov?: number }
//   pos = the screen's centre on the real wall; yaw = the direction the screen faces (into the room);
//   pitch = the mount camera's pitch, degrees (+ = up; unset: the terminal's default, a little down);
//   fov = the mount camera's VERTICAL field of view in degrees, exactly three.js's PerspectiveCamera.fov
//   (Godot: Camera3D.fov with the default keep_aspect = KEEP_HEIGHT); unset = DEFAULT_SPOT_FOV = 70.
//   The horizontal fov depends on the screen: horizontalFov(vfov, aspect = 16/10) =
//   2·atan(tan(vfov/2)·aspect) — ≈ 96.5° for the default on a 16:10 wall tablet.
interface DuckSpot { id: string; room: string; pos: Vec3 }   // pos = where the duck sits (its feet)
interface Prop {
  id: string; room: string; kind: "box" | "cylinder" | "screen" | "label" | "king";
  pos: Vec3;                    // centre of the base
  size: Vec3;                   // [w (x), h (y), d (z)] before yaw
  yaw?: number; color?: string; label?: string; solid?: boolean;   // solid: collides (default true for box/cylinder/king)
  hp?: number;                  // king only: hit points before he is "pawns only" (1–9, default 4)
  signals?: { won?: string; lost?: string; drawn?: string };   // king only: the story signals the game posts
                                //   (defaults "chess won" / "chess lost" / "chess drawn")
  armed?: { path: string; min: number };   // king only: the fight is ARMED (not practice) while the world var
                                //   at `path` (read off the mod view) is ≥ `min`; absent = no badge
}
interface SpaceTransform { offset: Vec3; yaw: number; scale: number }
```

Validation (`validateHouse`) returns `{ ok, problems: string[], house? }`
(`house` normalized, defaults filled) and refuses:

- **Shape:** a wrong type or a missing field, non-finite numbers, an
  unknown `kind` / `up`, a bad colour, unknown or duplicate ids.
- **Floors and rooms:** a room on an unknown floor; a non-rectilinear or
  self-intersecting polygon; two rooms on one floor that overlap (positive
  area); two floors whose elevations differ by ≤ 0.5 m (`FLOOR_SLACK` — a
  point on the lower one would `locate` on the upper); a room whose wall top
  (`buildWalls`'s: `room.height ?? floor.height`, or the fence height
  outdoors) rises above a higher floor's elevation where a room of that
  floor overlaps or touches it (within 1 mm) — the games collide with every
  wall whatever its floor, so such a wall would poke through the floor
  above.
- **Doors:** an unknown room, a door joining a room to itself or rooms on
  different floors; an `at` that is not on a wall of room `a` (and a wall
  `b` shares with it, when `b` is not null) — measured, exactly as
  `buildWalls` step 5 does, against the wall's **mm-rounded** line:
  `|mmi(c) − coord·1000| ≤ 20` (+1e-6), so a validated door is always cut;
  a gap that runs past the wall run; a door to the outside (`b = null`) on
  a wall another room of that floor also has (name that room as `b`, or
  `route` would not know the passage); a gap that overlaps another door's
  on the same line (lines within 2 × 0.02 m); a `guard` that names an
  unknown prop, a prop that is not a `king`, or a king whose `room` is
  neither `a` nor `b`.
- **The King:** `hp` not an integer 1–9, `signals` not `{won?, lost?,
  drawn?}` of strings, `armed` not `{path, min}`; any of the three on a
  prop that is not a `king`.
- **Stairs:** an unknown room; a rect that is not `x0 < x1`, `z0 < z1` by
  at least 1 mm; `from` and `to` on one floor, or `from` not the lower; a
  rect not inside both rooms; less than 0.3 m (`STAIR_CLEARANCE`) of `to`
  beyond the head (the `up` edge) or of `from` beyond the foot; a stair
  that passes a floor between its two where a room of that floor overlaps
  the rect (that floor would get no hole); two stairs that share a floor
  and whose rects overlap in plan (a stairwell stacked flight over flight:
  the lower flight's hole and rails sit where the upper one starts, so
  nothing could walk it — when measuring a real house with stacked stairs,
  draw the flights side by side or end to end; the virtual house only has
  to read like the real one).
- **Placed things** (terminals, duck spots, the spawn, props): an unknown
  room; a plan point outside the room's footprint (± 0.05 m,
  `SPOT_TOLERANCE`). A terminal or prop: a `y` outside its room's storey
  (`elevation − 0.05` to `elevation + height`). A duck spot or the spawn is
  checked like a player: `floorOf(y)` must be its room's floor; a duck spot
  sits 0 (−0.05) to 1.2 m (`DUCK_MAX_RISE`) above it, the spawn within
  0.45 m (`STEP_UP`) of it; one strictly inside its polygon must `locate` to
  its own room (not a stair's other room); and it must not be buried in a
  solid prop — inside the prop's footprint with `y` below its top
  (−0.01 m) while `y` + 0.5 m (duck) / 1.7 m (spawn) is above its base
  (rest it on top instead: the duck on the kitchen counter).

Room `location` names are **not** checked by the validator (it has no
model); the server warns (log + `warnings` in the response) when a
`location` names no `LOCATION`. `guardWarnings(house)` is the package's
own advice on a valid map — a door's guard whose base centre stands more
than 1.0 m (`GUARD_REACH`, plan) from the door's point is not in the
doorway — and the server's `houseWarnings` folds it into the same
`warnings` (the map page lists them; nothing blocks a save).

`doorGap(house, door) → WallSegment | null` is the gap a door cuts, as
`buildWalls` step 5 cuts it on a validated map: room `a`'s mm-rounded wall
line, `lo..hi` = `mmi(t ± width / 2)`, `bottom` = the floor elevation,
`top` = the door top (null when no edge of `a` carries the door). The games
stand a closed leaf in a guarded door's gap and collide with it like a
wall while its king stands.

### 1.2 Geometry (normative — the Godot port is diffed against it)

`buildWalls(house) → WallSegment[]`:

```ts
interface WallSegment {
  floor: string; axis: "x" | "z";   // "x": the wall runs along x at z = c; "z": along z at x = c
  c: number; lo: number; hi: number; // the line and the interval on it
  bottom: number; top: number;       // world y
  kind: "wall" | "fence" | "lintel" | "rail";
}
```

1. **Edges.** For every room, every polygon edge `p[i] → p[(i+1) % n]`
   with non-zero length gives `(floor, axis, c, lo, hi, room)`; collinear
   consecutive edges are not merged here.
2. **Lines.** Group edges by `(floor, axis, round(c · 1000))`.
3. **Elementary pieces.** On each line take every `lo`/`hi` as a breakpoint
   (sorted, deduplicated at 1 mm). For each consecutive pair `[u, v]`, the
   *contributors* are the rooms whose edge covers it. Height of the piece:
   the maximum over contributors of `room.height ?? floor.height` for an
   indoor room, `style.fence ?? 1.0` for an outdoor room. `bottom` =
   floor elevation, `top` = bottom + height. `kind` = `"fence"` when every
   contributor is outdoor, else `"wall"`.
4. **Merge** consecutive pieces with equal `kind`, `top` and touching ends.
5. **Doors.** For each door (array order), on room `a`'s floor, find the line
   with the door's axis whose `c` is within 0.02 m of the door point
   (`axis "x"` ⇔ the door point's z ≈ c; try `"x"` first, then `"z"`), and
   the segment containing the door centre (only `"wall"`/`"fence"` pieces;
   several lines in tolerance → the nearest, then the lower `c`). Cut
   `[t − w/2, t + w/2]` (t = the door's coordinate along the line, clipped to
   the segment) out of it; when `bottom + (door.height ?? style.doorHeight ??
   2.0)` < the segment's `top`, add a `"lintel"` over the gap from
   `bottom + doorHeight` to `top`. A fence gets no lintel.
6. **Rails.** For each stair, on the upper room's floor, a `"rail"` of
   height 1.0 along each of the three rect sides other than `up`.
7. **Output** rounded to 1 mm, sorted by `floor` (floors array order), then
   `axis` ("x" < "z"), then `c`, then `lo`, then `kind` (code-point order),
   then `hi`, then `top`.

Rounding is `mmi(v) = floor(v · 1000 + 0.5)` (integer millimetres — JS
`Math.round`, *not* GDScript `round()`, which rounds half away from zero).
The reference works in integer mm throughout steps 1–6 (edge coordinates,
breakpoints, merges, door cuts; `top = mmi(elevation + height)`) and divides
by 1000 on output.

`buildFloors(house)` — one plan polygon per room (minus stair holes for the
upper room) at its floor's elevation; indoor rooms also get a ceiling at
`elevation + height` (minus holes over a lower stair). `buildRamps(house)` —
per stair, the sloped quad (four corners in house coords). Triangulation is
each engine's own (three `ShapeGeometry`, Godot `Geometry2D`); only walls,
ramps, routes and locate are conformance-tested.

**Locate.** `floorOf(house, y)` = the highest floor whose elevation ≤
`y + 0.5` (else the lowest). `roomAt(house, [x, z], floorId)` = the room on
that floor whose polygon contains the point (boundary counts; first in
array order). `locate(house, p: Vec3) → { floor, room | null }` uses both,
but a point over a stair rect (boundary counts) whose `floorOf(y)` is one
of the stair's two floors is in the stair's `from` room when its y is
strictly nearer the lower elevation, else in `to`. `heightAt(house, [x, z],
yHint)` = of the candidate surfaces under the point (each room floor
containing it, except where the point is strictly inside a stair hole in it —
the hole is the open rect; each ramp whose rect contains it, boundary
counting, at its interpolated height, clamped), the highest one ≤
`yHint + 0.45`; if none, the lowest candidate; if no candidate at all,
`null`.

**Route** (`route(house, from: Vec3, to: Vec3) → Vec3[]`, "follow the
indicators") — a visibility graph over doors, stairs and corner waypoints.
`c` = 0.35 m (`ROUTE_CLEARANCE`), `ε` = 1e-6 (`ROUTE_EPS`, the one
tolerance: metres, and m² for orientations).

1. **Nodes**, in order, each `{pos, rooms}`:
   - *Portals*: every door **but a guarded one** (`guard`: `route()`
     keeps it shut, never a portal) — its point at room `a`'s floor
     elevation; rooms `a` and `b`, or just `a` when `b` is null — then per
     stair the *foot*
     (centre of the edge opposite `up`, lower elevation, room `from`) and
     the *head* (centre of the `up` edge, upper elevation, room `to`).
     A game that lets the King fall (the fight is per session) must not
     route its trail over the map as it is: once he is down a player can
     be behind his door, and a trail from there would cross a wall. It
     routes over a copy with that king's doors unguarded and his prop
     removed (reinstall/web `trailMap`, rebuilt on the fall, on bind and
     on a remap). VR never fells him, so it routes over the map as is.
   - *Reflex waypoints*: per room (array order), per vertex `v = p[i]`
     (vertex order) with neighbours `p = p[i−1]`, `q = p[i+1]` (cyclic):
     with `A = Σ (xᵢ·zᵢ₊₁ − xᵢ₊₁·zᵢ)` and `k = (v−p)ₓ·(q−v)_z − (v−p)_z·(q−v)ₓ`,
     `v` is reflex when `k ≠ 0` and `k`'s sign differs from `A`'s. Its
     waypoint is `w = v − c·(û_p + û_q)`, `û` the unit vectors from `v`
     toward `p` and `q` (for a rectilinear corner: `c` along each axis, into
     the room), kept only when inside the room (boundary within `ε`
     counts). Room = that room only.
   - *Stair waypoints*: per stair (array order), its rect's corners moved
     `c` outward along each axis — `[x0−c, z0−c] [x1+c, z0−c] [x1+c, z1+c]
     [x0−c, z1+c]` — first as waypoints of the upper room `to` (round the
     hole), then of the lower room `from` (round the ramp), each kept only
     when inside that room (boundary within `ε` counts).
   - *Prop waypoints*: per prop (array order) that is solid (`propSolid`:
     `solid`, else true for `box` / `cylinder` / `king`) and whose `room`
     exists, the
     corners of its obstacle rect `[x0, z0, x1, z1]` (step 2) moved `c`
     outward along each axis, in the same order `[x0−c, z0−c] [x1+c, z0−c]
     [x1+c, z1+c] [x0−c, z1+c]`, as waypoints of the prop's room only —
     each kept only when inside that room (boundary within `ε` counts)
     **and** strictly inside none of that room's obstacles (step 2, stairs
     and props alike; *strictly* = `x0 < x < x1 ∧ z0 < z < z1`, no
     tolerance).
   - A waypoint's y is its room's floor elevation.
2. **Obstacles** of a room, in order:
   - the rect of every stair whose `to` or `from` it is (stairs array
     order), shrunk by 0.01 m on every side (`OBSTACLE_SHRINK`, so a
     stair's own foot and head see out);
   - then every solid prop whose `room` is this room (props array order;
     a prop counts only in its own room): the axis-aligned bounds of its
     footprint grown by `m` = 0.25 m (`PROP_MARGIN`, the walker's body
     radius) on every side, **not** shrunk. With `[w, h, d] = size`,
     `[px, py, pz] = pos`: a `cylinder` has `hx = hz = max(w, d) / 2`;
     any other kind has, with `r = yaw·π/180` (`yaw` default 0),
     `hx = (w/2)·|cos r| + (d/2)·|sin r|` and
     `hz = (w/2)·|sin r| + (d/2)·|cos r|`. The rect is
     `[um(px − hx − m), um(pz − hz − m), um(px + hx + m), um(pz + hz + m)]`
     with `um(v) = floor(v · 1e6 + 0.5) / 1e6` (integer micrometres, so a
     trig ulp — `deg_to_rad` vs `·π/180` — never reaches a decision). A
     prop's height and y are ignored (a solid prop is in the way on its
     whole floor).
3. **Visible(a, b, room)** — on the plan segment `ab`:
   - it *properly crosses* no edge `cd` of the room's polygon: with
     `o(a, b, c) = (b−a) × (c−a)`, both `o(a,b,c)`, `o(a,b,d)` and
     `o(c,d,a)`, `o(c,d,b)` are pairs of strictly opposite signs beyond `ε`
     (touching, ending on, or running along an edge is not a crossing);
   - its midpoint is in the polygon (boundary within `ε` counts);
   - it runs through none of the room's obstacles: Liang–Barsky clips `ab`
     to the closed rect (`p = [−dx, dx, −dz, dz]`, `q = [aₓ−x0, x1−aₓ,
     a_z−z0, z1−a_z]`; `p = 0` with `q ≤ ε` ⇒ misses; else `t = q/p` raises
     `t0` when `p < 0`, lowers `t1` when `p > 0`, from `[0, 1]`), and it
     hits when `(t1 − t0)·|ab| > ε`. An obstacle that strictly contains `a`
     or `b` (`x0 < x < x1 ∧ z0 < z < z1`) is skipped for that segment
     (someone standing on the stair; the duck on the kitchen counter).
4. **Graph.** Nodes `i ≠ j` are adjacent when they are the foot and head
   of one stair, or when they share a room (rooms of `i` in order) in which
   they are Visible; weight = 3-D distance.
5. **Search.** Locate both ends (§ Locate). Either room null (or unknown)
   ⇒ `[from, to]`. Same room and Visible(from, to) ⇒ `[from, to]`.
   Otherwise Dijkstra from a virtual start joined to every node of the
   start room that is Visible from `from` in it, to a virtual end joined
   from every node of the end room that sees `to` in it (Visible(node,
   to)). Nodes settle in order of distance, then index — the virtual end's
   index is after every node — and relaxation is strict `<`, so ties go to
   the lower node index. Result: `[from, …node points, to]`; no path ⇒
   `[from, to]`.

> **What it guarantees (not normative).** Inside a room every leg stays in
> the room's polygon at its ends and midpoint and crosses none of its edges
> properly, so a route no longer cuts a corner of a concave room — the
> show's backyard, which wraps round the tent, turns at the yard's reflex
> corner off the tent's north-west (`[1.65, 0, 18.65]`) instead of running
> through the tent's north wall — and no leg crosses a stair hole or its
> rails, or the ramp footprint below, and no leg runs through a solid
> prop's grown bounds — a route across the yard turns at the Truth Pong
> table's corner waypoints (`[4.015, 0, 14.52]`) instead of crossing the
> table. Doors are walked through at their centre point; legs
> may run along a wall or touch a corner. A prop whose outer corners all
> fall outside its room (one pushed against two walls) adds no waypoints,
> so a route may detour through a door to reach past it, or — with no way
> round at all — fall back to `[from, to]`. A leg leaving the polygon
> exactly through two vertices could in principle slip past the edge test;
> the 0.35 m waypoints keep the show's routes clear, and
> `house/test/route.test.ts` checks every route from the spawn and from
> every room's label point to every duck spot against the map's
> `buildWalls` walls, fences and rails, the stair holes, and the interior
> of every solid prop's footprint (but one holding a leg's end). The
> `props` fixture's goldens pin the prop rule for ports.

**Space transform.** `toSpace(t, p)`, `fromSpace(t, p)`, `yawToSpace`,
`yawFromSpace`.

### 1.3 Where the map lives

- The show's map: `core/examples/trapped-in-the-internet/house.json` —
  a **placeholder layout** (guessed dimensions) until the real house is
  measured, but with the story's structure: every LOCATION has a room, the
  tent (The Internet: the spawn, the station mats, the `tent` terminal) is
  an indoor room in a notched backyard, the Server Room has a door and no
  duck. Edit it with the **map editor** (`/reinstall/map`) or by hand.
- Its rain variant: `house.shed.json` beside it (the file convention is
  `house.<variant>.json`) — the same map with The Internet in the shed
  (room `shed`) and no tent, the same terminal ids, duck spots and
  LOCATIONs. `core/test/show-house.test.ts` validates both, routes from the
  spawn to every duck spot, and pins what they share; `pnpm test:vr` has
  been run on both (2026-10-15).
- Duck placement rules the show test enforces, because the find is plan
  distance + floor only (no wall test — web `REACH`, VR `Duck.FIND_RADIUS`,
  both 0.9 m): every spot is at least 10 m of walking from the spawn on
  either variant, and no spot can be reached through a wall — nowhere a
  player's feet fit (0.31 m off a wall line: body radius + half a wall)
  within 0.9 m of a spot is in another room on its floor. In practice:
  keep a spot ≥ 1.21 m from any wall it shares with a walkable room.
- **The map belongs to the project** (SW-MAP-01). A project's map files
  are ordinary project files beside the `.loom` story: `house.json` (the
  default **variant**) and any `house.<variant>.json` (`<variant>` =
  1–40 of `A–Z a–z 0–9 _ -`, e.g. `house.shed.json`), at the project's
  root (`core/server/house-maps.ts` `isMapFile`). They are not story — the
  launch source concatenates `.loom` files only. A project made from an
  example template gets the example's maps; `core/scripts/sync-example.ts`
  pushes them, but **the project's copy wins** (a survey kept with "Save
  to project" lives there): an example map is only added when the project
  lacks that file, a differing project map is kept and both versions are
  summarised; `--replace-maps` overwrites (and deletes the ones the
  example lacks, copying the old text to a temp directory first),
  `--keep-maps` touches none. Each variant is a **whole map**, validated
  on its own — a map file that doesn't validate is refused wherever one is
  written (`PUT /api/projects/:id/files` 400 + `problems`, an empty new
  file aside; `/api/mod/load {maps}` 400 before the restart; sync-example
  stops before writing). The server stays show-agnostic and labels a
  variant by its file (and the map's `name`, or its `variant` field —
  the `label` below).
- **A launch snapshots them** like `scenario_source`: on the event row
  (`event.house_maps`, jsonb, file → text) and in the event's state dir
  (`spatial-maps.json`, with the **active variant**), so an event plays a
  fixed map through a server restart (the files come from the row, like
  the story — a sync written there while the server was down is what it
  plays; the state dir's copy covers an event with no row snapshot, and the
  active variant is always the state dir's), a reload (`POST
  /api/projects/:id/event/reload`, "Push draft") refreshes the snapshot
  (the active variant is kept while its file exists, else the default),
  and End → relaunch is a new event on the project's current maps **and
  the variant the last event played**: the choice is also recorded on the
  row (`event.map_variant`, written on every switch), and a launch seeds
  the new row from the project's last event, so a rain night switched to
  the shed relaunches on the shed (a fresh state dir starts on the row's
  choice; the state dir's own wins once it has one). Old event rows (no
  snapshot) play the show's file.
- The event server serves the event's map, the first that exists and
  validates: **(1)** the director's save for this event —
  `STATE_DIR/<eventId>/spatial-house.json`, or `STATE_DIR/spatial-house.json`
  for the default (env-passcode) event, which journals to the state-dir
  root; **(2)** the project snapshot's active variant (default
  `house.json`); **(3)** the show's file (env `LOOM_HOUSE`, else the
  example's `house.json` — now only the fallback). `source` on `GET
  /api/spatial/house` says which (`event` | `project` | `show`). The save
  is deliberately *not* named `house.json`: `LOOM_HOUSE` may well be
  `/data/house.json` and the default event's state dir that same `/data`.
  Mount an override read-only, outside the state dir, all the same.
- A director's save stays the event's own until it is retired: **Save to
  project** writes the event's current map into a project file (default:
  the active variant's) and, when that is the active variant, deletes the
  save (the event now plays the project's copy); a **variant switch**
  drops it (it was an edit of the old variant). A reload (Push draft) and
  a restart (Go live in place, Reset) keep it — the morning reset checks
  the map page's status line reads "the project's map". An
  event with no project map files (the LAN default event, an old project)
  switches among the **show file's siblings** instead: `LOOM_HOUSE=
  /config/house.json` → `/config/house.<variant>.json`.
- The show's file is re-read whenever its **mtime** changes (a hand edit,
  a file mounted after boot): while an event runs on the show's file (or a
  chosen sibling), a changed valid file replaces its map and is announced
  (`house` frame, live ducks follow, §2.2). A missing, half-written or
  invalid file is logged once and never sticks — the last good map keeps
  serving. An event running on a director's save or a project snapshot
  never follows the show's file.
- Both games and the terminals fetch the map at start (`GET
  /api/spatial/house`) and refetch on a `house` frame, and on `hello`
  (every stream (re)connect) whenever its `houseVersion` differs from the
  map they hold — a `house` frame missed while the stream was down is
  caught up there. Each also bundles the show's file as an offline
  fallback (the web game never *plays* on it, §3).
- Godot: `reinstall/vr/house/house.json` is a copy kept identical by
  `pnpm --filter @loom/house sync` (a test fails when it drifts).

The shared code is the pure-TS package **`@loom/house`** (`house/`, no
dependencies): schema, `validateHouse`, `buildWalls`/`buildFloors`/
`buildRamps`, `locate`/`roomAt`/`floorOf`/`heightAt`, `route`, space
transforms, `pickDuckSpot`. Its subpath **`@loom/house/three`** (peer
dependency `three`) turns a map into a three.js scene: walls, floors,
ceilings, ramps, rails, props, terminal screens, room labels; the duck
model; the indicator trail; player avatars (ghosts with name tags). The web
game and the terminal both render through it, so they always look alike.

Golden fixtures for the Godot port: `house/test/golden/<name>.walls.json`,
`.routes.json`, `.locate.json`, generated by `pnpm --filter @loom/house
goldens` from `house/test/fixtures/*.json` + the show's `house.json`
(`name` = `show`). Each is a JSON array, one value per line, every number
rounded to 1 mm: walls = `WallSegment[]`; routes = `[{from, to, path}]`;
locate = `[{p, floor, room, height, standable}]` with `height = heightAt([x, z], y)` and `standable = standable(house, p)` (the queries include every solid prop's base and top).
Queries are stored with their answers, so a port only reads and compares.
A test fails when the committed goldens drift from the code.

## 2. Server — `core/server/spatial.ts`

A transport-free **`SpatialHub`** (the `AgentHub` pattern: injected `now`,
plain subscriber objects with `send(event, data)`), owned by
`EventRuntime`. **Poses never touch the journal, the chat or `fanout`** —
only the outcome does (`commit("signal", …)`). All routes exist on
`/e/:eventId/…` and on the bare default event.

**Trust model** (the terminal's): a game device is a *trusted device*
provisioned with the event's moderator passcode
(`POST /api/resolve-code` → `POST /e/:id/api/mod/login` → mod token). A pass
QR is only a guest id (`g-xxxxxx` / `p-xxxxxx`, `parseScan` from
`terminal/src/scan.ts`), never a credential. `begin` mints a **session
token** (random, in memory) that the game then uses for its own high-rate
calls; it can do nothing else.

### 2.1 Routes

| Route | Auth | Body / query | Result |
|---|---|---|---|
| `GET /api/spatial/house` | mod token (header or `?token=`), author session, or a session token | — | 401 none of those · 503 no map · `{house, version, source: "event" \| "project" \| "show", duck?}` (§1.3) — `duck` (the session's current `DuckSpot`) only when the caller is a live session token: a map save may have moved or re-dealt it, and this is how a parked assignment (not on the stream yet) learns of it |
| `POST /api/mod/spatial/house` | mod | `{house, base?}` — `base` = the version the editor loaded | 400 `{error, problems}` (checked first) · 409 `{error: "the map changed — reload", version}` when `base` is given and is not the current version (the map is loaded first if nothing has yet; no / null `base` = no check, last write wins) · 200 `{ok, version, warnings}`; persists `spatial-house.json` in the event's state dir (§1.3); streams get `house {version}`, then a `duck` frame per player whose duck moved (§2.2) |
| `GET /api/mod/spatial/variants` | mod | — | `{variants: [{file, name, label?, active, ok, problems}], from: "project" \| "show", edited, project}` — every whole-map variant (the default file first, then by name; `name` = the map's own, else the file; `label` = the map's `variant` field, trimmed, when it has one — the map page's button reads it first), each validated afresh; `from` = the project snapshot, or the show file's siblings when it has no map files; `edited` = a director's save is in force; `project` = the event has a project (Save to project works) |
| `POST /api/mod/spatial/variant` | mod | `{file, base?}` | 404 `{error: "no such map variant", variants}` · 400 `{error: "invalid house map", problems}` · 409 as for `house` on a stale `base` · 200 `{ok, version, warnings, file, dropped}`. **The tent ↔ shed switch** (SW-MAP-13), mid-show too: the same path as a save (live sessions carried over, ducks kept by spot id or re-dealt, `house` then `duck` frames), nothing saved; the active variant is remembered for the event (survives a restart) and on its row (`event.map_variant`, which End → relaunch starts on); a player standing where the new variant has no floor goes back to its spawn (§2.2); `dropped` = a director's save was in force and is gone |
| `POST /api/mod/spatial/house/project` | mod | `{file?, base?}` — `file` default: the active variant's (a show sibling's too, on an event with no project maps yet, when it is named like a map file), else `house.json` | 409 `{error: "this event has no project — download the map instead"}` (the LAN default event; no `version`) · 400 not a map file name · 409 stale `base` · 502 the write failed · 200 `{ok, file, version}`. **Save to project**: writes the event's current map (two-space JSON + newline) as that project file — through the live co-editing doc when it is open, announced to every editor's tree — and records the snapshot on the event row, so the next launch and every co-writer see it. When `file` is the active variant, the director's save it came from is retired (the event now runs on the project's copy; same version, no frame) |
| `POST /api/mod/spatial/begin` | mod | `{guest, world: "vr" \| "web", device, station?}` | 409 no scenario · 404 unknown guest · 400 bad world · 503 no map · 200 `Assignment` (below). An active session for the same guest is ended (`leave {reason: "replaced"}`). With `station`, the assignment is parked for that station until it claims it, and an older assignment still parked there is ended (`replaced`). |
| `GET /api/mod/spatial/station` | mod | `?id=vr-1&name=Headset 1&world=vr` | marks the station seen; `{assignment: Assignment \| null}` — the newest unclaimed assignment for it |
| `GET /api/mod/spatial/stations` | mod | — | `{stations: [{id, name, world, online (seen < 5 s), busy: {session, guest, name} \| null}]}` |
| `GET /api/mod/spatial/candidates` | mod | — | `{players: [{id, name, captured, location}]}` — every guest/persona, captured first then by name |
| `POST /api/mod/spatial/end` | mod | `{session}` | `{ok}` |
| `POST /api/spatial/pose` | session token (`x-loom-token`) | `{p: Vec3, yaw, pitch?, t?}` (≤ 2 KB body, read before the generic 4 MiB parse); `p` is the player's **feet** (the floor point under the body — the eye is 1.6 m above it), `yaw` the view direction, `pitch` the head (degrees, + = up) | 204 · 400 malformed · 401 unknown token · 410 session over (the last 1000 ended tokens are remembered). First pose **claims** a parked assignment — and ends any *other* session on that station (`leave {reason: "replaced"}`: a headset that crashed mid-game never ended its last one). Poses (and the stream) **ignore pause**: they never touch the story. |
| `POST /api/spatial/found` | session token | `{}` | 401 / 410 as for poses · 409 `{error: "doors are closed"}` while the event is not open (paused, or before the doors open) — the session stays un-found, so the game's retry lands after resume · 409 `{error: "this session has not started — send a pose first"}` for a parked assignment no pose has claimed · 409 `{error: "not near the duck", distance, dy}` unless the last pose is within 2.0 m (plan, `FOUND_PLAN_M`) of the duck **and** either within 1.2 m of its height (`DUCK_MAX_RISE`; a pose is the feet) or on the same floor (`floorOf`) — `nearDuck` · 200 `{ok, released, already}`; commits `signal("the simulation completed", guest)` then `signal("the golden duck", guest)`, journaled `by` the session's `device`, and appends the run (`DuckRun`: guest, name, world, device, `ms` from the begin — or a parked assignment's claiming pose — to the find, less any time the doors were closed — a pause mid-run is not the player's time) to `spatial-runs.jsonl` in the event's state dir, which `/api/mod/recap`'s `duck` board reads (cleared by a story restart). A repeat answers `already` without committing. |
| `POST /api/spatial/end` | session token | `{}` | `{ok}` |
| `GET /api/spatial/stream` | mod (`?token=` / author session) or session token | `?name=Kitchen` | SSE, below |

```ts
interface Assignment {
  session: string; token: string;           // session id (public) + session token (secret)
  guest: string; name: string;               // the program
  world: "vr" | "web"; device: string; station: string | null;
  captured: boolean;                         // corrupted — finding the duck releases them
  duck: { id: string; room: string; pos: Vec3 };
  spawn: { room: string; pos: Vec3; yaw: number };
  houseVersion: string;
}
```

The duck spot is `pickDuckSpot(house, sessionId, avoid)`: FNV-1a 32 of the
seed over the spots, skipping the spawn room's spots and the spot this guest
found last (when another spot remains).

### 2.2 The stream

`text/event-stream`, `:ok` first, `:ping` every 25 s, kept in its own set
(never in `clients`, never sent snapshots):

| Frame | Data |
|---|---|
| `hello` | `{eventId, houseVersion, players: PlayerState[]}` |
| `join` | `{player: PlayerState}` |
| `poses` | `{t, players: [{session, p, yaw, pitch, room, floor}]}` — every 100 ms, only players whose pose changed since the last flush |
| `found` | `{session, guest, name, duck, released}` |
| `leave` | `{session, reason: "ended" \| "found" \| "timeout" \| "replaced" \| "reset"}` |
| `house` | `{version}` — refetch the map |
| `duck` | `{session, duck: DuckSpot}` — sent right after a `house` frame, once per player on the stream whose duck moved (another position or room) or was re-dealt (its spot is gone). Never for a parked assignment (it reads its duck from `GET /api/spatial/house`) or a session that already found its duck (that duck stays put) |
| `reset` | `{kind}` — the story restarted; every session is over |

`PlayerState = {session, guest, name, world, device, p, yaw, pitch, room,
floor, duck, found, startedAt}`; `room`/`floor` are computed server-side
with `locate`. A session with no pose for 60 s leaves (`timeout`); a found
session lingers 8 s (so terminals can celebrate) then leaves (`found`). A
parked assignment is not a player yet (no `join` until its first pose); one
nobody claims within 5 min is dropped. `released` (in `found` frames and
the `found` response) means the program was captured and no longer is.
`EventRuntime.restart()` ends every session (`reset`), `dispose()` ends the
streams. `hello` is sent on every (re)connect, so a client compares its
`houseVersion` with the map it holds (§1.3).

**A new map mid-game** (a director's save, the tent ↔ shed switch, or a
changed show file): `setHouse` keeps every live session going. One that hasn't found its duck
keeps its spot **id**, so a moved room carries the duck along and the
session takes the spot's new position; a spot the new map no longer has
is re-dealt (`pickDuckSpot`, still avoiding the one this guest found
last). Rooms and floors are recomputed (the next `poses` flush carries
them), a parked assignment moves to the new spawn, and every session's
`houseVersion` becomes the new one. A player stays where they stand
unless that is not **`standable`** on the new map (`@loom/house`: in a
room, over a surface, not buried in a solid prop — one stepped over at
5 cm aside): then they go back to the new map's spawn. The rain variant
is the case that needs it — the shed is a room on `house.shed.json` and a
solid box prop on `house.json`, flush with the yard's fence, so a program
standing in it on a switch back to the tent would be wedged between the
box and the fence. The server re-seats its copy of the pose; the web game
(`bodyAfterRemap`) and the VR game (`respawn_after_remap`) apply the same
rule to their body when they load the new map (the locate goldens pin
`standable` for the GDScript port). Then `house {version}`, then the
`duck` frames above.

## 3. The web game — `reinstall/web/` (`loom-reinstall`)

React shell + three.js canvas (three r186 needs WebGL2: the wizard probes
for it once and, without it, disables **Play here** with the reason rather
than begin a session it can't draw). Screens: **setup** (moderator passcode,
device name, role) → **scan** (camera via the terminal's `Scanner`, typed
name fallback via `candidates`) → for a scanned program, **Play here** or
**Send to <station>** (online VR stations listed) → **play** → **found**
(the duck lays a golden egg and flies; "Reinstallation complete" or, for a
program that wasn't corrupted, "You found Gerald") → back to scan.
Provisioning link: `/reinstall/?code=<mod>&name=Tent tablet`. The scan
step's **⚙ Setup…** and **🗺 House map** open only after a 2 s hold
(`kiosk.ts`, a copy of the terminal's `useLongPress`; W-15): the tablet
is in guests' hands.

Play: first-person, eye height 1.6 m, walk 1.8 m/s (run ×1.6 with Shift),
circle-vs-wall collision (radius 0.25) against `buildWalls` segments whose
vertical span overlaps the body, `heightAt` for floors and stairs, solid
props as boxes, and head clearance: a floor or ramp surface strictly
between step-up (0.45 m) and body height above the feet refuses the move,
so the walker slides along the underside of a stair instead of walking
into it. Controls: left on-screen stick = move, right stick = turn
(x) and look (y); keyboard WASD/arrows/QE/Shift; mouse drag to look. The
indicator trail (`route` → golden chevrons every 0.75 m, refreshed twice a
second; a player standing on a stair's ramp (in its rect and within
0.45 m of the ramp's surface; the nearest ramp if two overlap) is routed
out by whichever end of it makes the walk shorter — `[feet, end,
…route(end, duck)]` — because `route` from a point on the ramp starts in
one of the stair's rooms and would point back at the end just left; a
player who has walked under a stair's high end (on its `from` floor, in
the rect or within 0.3 m of a side along the flight, the ramp more than
0.45 m overhead) first steps 0.35 m out of the nearer side still in
`from` — else out of the high end — then follows `route`, which from
under the ramp would run along the underside into the solid; not
normative — the web game's `trail.ts`, ported as the VR game's
`Game.trail_path`), a compass/room HUD, the duck (bobbing, glowing, quacks via
WebAudio), other players as ghosts (from the stream), the terminals as
glowing screens on the walls ("someone is watching from the Kitchen").
Arrive within 0.9 m of the duck in plan, on its floor and within 1.2 m
(`DUCK_MAX_RISE`) of its height ⇒ `found` — tighter than the server's
rule (§2.1), so a claim the game makes is never refused for distance;
standing right under a duck perched higher than that says it is out of
reach. A 409 "not near the duck" buzzes and is retried on a backoff
(`foundRetryMs`: 1.5 s, 3 s, 6 s, then every 10 s); a 409 "doors are
closed" is **paused**, not far: the HUD says "The simulation is paused —
Gerald will wait for you.", no buzz, same backoff, so the find lands right
after resume. Poses at 10 Hz, latest-only (never queue).

Session lifecycle:

- A session with no input for 120 s ends itself (a countdown for the last
  20 s).
- While the tab is **hidden**, rendering, the pose keepalives and the
  idle countdown all pause — the server drops a tab hidden for 60 s
  (`timeout`) instead of every terminal showing a frozen ghost; coming
  back resumes the countdown where it was (and a session that timed out
  meanwhile learns it from the 410).
- **Leaving the page** (`pagehide`: reload, close, navigate) ends the
  session at once (`POST /api/spatial/end`, a keepalive fetch that
  outlives the unload).
- A session **plays only on the map it was dealt on**: "Play here" fetches
  the map (with the session token) until it gets the assignment's
  `houseVersion` — never the bundled stand-in — and otherwise ends the
  session and asks for a rescan. On `hello` / `house` with another version
  it refetches (one fetch at a time) and rebuilds the scene in place.
- **The duck moves when the server says so**: the session-token map
  fetch's `duck`, or a `duck` frame for this session, moves Gerald,
  re-routes the trail, clears warmer/colder and the found backoff, and
  says "Gerald moved" (not once he is found).
- A run restart (`reset`), a director's end, or the same program started
  elsewhere (`replaced`) returns the device to the scanner with a message.

### The King

The Cold Lock's chess game moved into the simulation (Wave 4, U15–U17):
a `king` prop stands in the server-room doorway of the show's map
(`cold-lock-king`, `hp: 8` — two hits a stage, `armed: {path: "Night.step", min: 14}`; the
door `server-door` names him as its `guard`). The web game is the only
place he is fought; everything is **per session** — his health lives in
the `Game`, nothing is shared between tablets, headsets or terminals. A
result still on its way is kept across a reload for 60 s (below).

- **The door.** While he stands, the guarded door's gap (`doorGap`) is a
  wall for the walker and `route` never passes it (`physics.ts`
  `closedDoors`; the scene's closed leaf, `HouseScene.doors`). When he
  falls the leaf is hidden, the physics world is rebuilt without him and
  the door (`omitProps`), and the trail re-plans.
- **Hits** (`game/fight.ts`, pure): **⚔** on the HUD or Space, one hit per
  2 s (`HIT_COOLDOWN_MS`; ≈ 16 s of hitting from full strength to pawns only on the show's hp 8), landing only on his floor, within 1.25 m of
  his base centre (`HIT_REACH`) and facing him within 55° (`HIT_CONE_DEG`);
  else a nudge ("Get closer to the King and face him."). Each hit takes one
  point (never below 0), staggers him and redraws his bar — ♥ per point,
  ♡ per lost, "PAWNS ONLY" at 0 (`@loom/house/three` `createKing`, a Win98
  title-bar sprite over his head). The stage is `stageFor(hp, max)` =
  `round(4·hp/max)`: 4 **grandmaster** → 3 **club** → 2 **beginner** → 1
  **dizzy** → 0 **pawns** (`STAGE_LINE` says which as it changes).
- **The board** (`chess/`, a lazy chunk with chess.js 1.4 — pure JS, no
  wasm, no worker, the tablet's CSP untouched): **♟** on the HUD or C (when
  a hit could land, or during its cooldown) opens `ChessWindow`, a Win98
  window over the simulation. The player is White; tap a piece, tap a
  square (no drag); a pawn on the last rank becomes a queen. The AI
  (`chess/ai.ts`, negamax / alpha-beta over material + piece-square tables,
  iterative deepening with node and time budgets, on the main thread, yielding
  between root moves) plays one profile per stage: grandmaster depth 3 /
  2.5 s, club 2 / 1.2 s, beginner 1 / 0.4 s, **dizzy** a random legal
  move, **pawns** his own worst move from `PAWNS_ONLY_FEN` (his king and
  eight pawns against a full side). 💡 Hint shows a good move for 2 s
  (10 s cooldown); Give up abandons — nothing changes. A badge reads
  **ARMED** / **PRACTICE** when the prop declares `armed` (`fetchArmed`:
  the world var off `GET /api/state?role=mod`; no badge while unknown).
  Every tap touches the idle leash, so a game in progress is never ended.
- **The result** (`Game.chessResult`): **checkmate** fells him (`fall()`
  topples him over 1.6 s), opens the door, plays the fanfare, says
  "CHECKMATE — the door opens." and posts the prop's `signals.won`
  (default `chess won`) and closes the board; the King winning posts
  `signals.lost` ("THE KING WINS. AGAIN."), a stalemate / insufficient
  material / threefold / fifty moves posts `signals.drawn` ("STALEMATE.
  AGAIN." / "DRAW. AGAIN."), and either deals a fresh board at the same
  stage in the still-open window (`redeals`, OCT31 decision 6: only
  checkmate opens the door); an abandoned game posts nothing. Each goes through `postSignal`: `POST
  /api/mod/signal {name, subject: <the program>, label: <device name>}`
  with the tablet's moderator token, retried on a network failure or a
  5xx (0.5 s doubling to 8 s, five retries); a 4xx is final. An attempt
  that hangs is aborted after 5 s (`SIGNAL_ATTEMPT_TIMEOUT_MS`), or at the
  60 s cap below if that comes first, and counts as a network failure. A win whose
  every retry failed says "The win didn't reach the house: tell a host
  (♟)." While a post is in flight it is also kept in `localStorage`
  (`loom-reinstall.pending-signal`, the latest only, try/catch'd) and
  forgotten once it lands, is refused, or fails for good (the host was
  told, so a late post would open the door twice); a page that died
  mid-retry leaves it, and the next page load posts it once (`flushPendingSignal`) only within 60 s of
  the first try (`PENDING_SIGNAL_MAX_AGE_MS`, also checked before every
  retry) and for the same event, and drops anything older: `chess won`
  unlocks the real door, so a stale win never lands late. The story treats `chess won` exactly as the ♟ fallback button
  does (§6): the Y2K gate is the story's, not the game's — before it the
  door still opens in the simulation, as practice.
- **Out of scope** (device check pending — the wall chess phone stays the
  fallback, U17): the hit feel, the glyph fonts on the oldest tablets, a
  grandmaster stall on a slow SoC; a pawns-only stalemate opens nothing (it
  deals again).

The **map** page (`/reinstall/map`): the house plan (SVG, one floor at a
time), live players, the duck of each session, terminals with their view
cones; an **editor** for directors, saving through
`POST /api/mod/spatial/house` with `base` = the version it loaded (none
for the bundled stand-in, which is read-only anyway). A 409 saves nothing
and offers **Copy my edits (JSON)** and **Reload the map**; a successful
save moves the page's base to the new version. A terminal's view cone is
drawn `horizontalFov(fov ?? 70)` wide (§1.1). A terminal's provisioning
link is offered from its row. The page's **project bar**
(`reinstall/web/src/map/ProjectBar.tsx`, logic in `map/project.ts`,
mounted in the toolbar's `toolbarExtras` slot) toggles the variants,
labelled **Tent** / **Shed** (`variantLabel`: a `house.<v>.json` file's
`<v>`; `house.json`'s one distinguishing word in its map name, else
*Main*), the playing one tagged **● live** (`GET …/variants`, `POST
…/variant` with `base`; it asks first while programs are mid-game, a
director's save would be dropped, or the page holds unsaved edits). A
switch is live for every player at once, so the page reloads onto the
server's map and version (a clean draft, never an undoable edit). It
offers **Save to project** (`POST …/house/project`, only on an event with
a project; it sends the file it names in its confirm, `saveTarget`; a
valid unsaved draft is saved to the event first; the page reloads after)
and **Download JSON** (the shown map as the active variant's file, to
commit as the show's file). The page's first write in a page load (💾
Save, a switch, Save to project) asks for the **moderator passcode**
again (`map/unlock.ts` `MapUnlock`, checked through `/api/resolve-code`:
a mod code for the device's event; W-15's stand-in for SW-MAP-11); a
cancel writes nothing. The device's token is unchanged and still full
admin.

The editor works **within the §1.1 schema** — it never adds a field —
and every op is pure (`reinstall/web/src/map/`: `edit.ts`, `doors.ts`,
`yards.ts`, `structure.ts`), so undo / redo are stacks of map values:

- **Floors**: add (id slugged from the label), edit label / elevation /
  height (what stands on the floor rides an elevation change), delete with
  its rooms and everything in them (refused for the last floor or the
  spawn's).
- **Rooms** are drawn as rectangles (or typed W × D / x, z — the
  inspector's number fields commit on Enter / blur, since every value is a
  real resize that clamps doors and re-cuts yards); polygon rooms
  from the JSON still move, validate and delete. Delete cascades to the
  room's doors, stairs, terminals, duck spots and props (refused while the
  spawn is in it).
- **Doors** are clicked onto a wall line; `a` / `b` are read off the plan
  by sampling just either side of the line (one room there: `b: null`).
  A door slides along its line (re-linking where it lands), "Open the
  whole edge" spans its run, and doors (and wall-mounted things) follow a
  moved or resized room edge, re-linked and kept inside their run.
- **Yards**: an indoor room drawn, moved or resized over an outdoor room
  cuts it — the yard's area minus every other room on the floor,
  decomposed on the grid of polygon coordinates and split into as few
  simple, hole-free pieces as it takes (same label / LOCATION; touching
  pieces joined by a door spanning their whole shared edge), doors into
  the yard re-linked, things re-homed, and a flap door added on the room's
  side facing the most yard when it has none and is free-standing (no
  indoor room beside it — a house room drawn into the yard gets none).
  A part of the yard the cut seals off (no opening to the rest, no door,
  no stair, not the spawn's) gets a flap from the room, and then the room
  one into the rest unless it has another way in. A yard's pieces are one
  place: deleted whole, never made indoor or nudged one piece at a time,
  and its label + LOCATION may not equal another yard's on the floor. A room that stood in the
  yard (fenced by it on ≥ half its edge) gives its footprint back when it
  moves away or is deleted; "Fill the yard" re-cuts a yard from its
  bounding box.
- **Stairs**: draw the rect on the lower floor; `from` / `to` default to
  the rooms under its middle on this floor and the next one up.
- **Checks**, live: `validateHouse`'s problems (each read back to the
  thing it names, a click selects it), plus two warnings that never block
  a save — **walkability** (`route()` from the spawn to every duck spot,
  the VR autopilot's algorithm; and every room no door / stair chain from
  the spawn's room reaches) and the story's LOCATIONs (from the mod
  view, `GET /api/state`): a room naming none, a LOCATION no room is;
  the server's `warnings` on a save add `guardWarnings` (a king too far
  from the door he guards).

## 4. The terminals — world view

`TerminalConfig` gains `spot` (a `house.terminals[].id`; the terminal's
place) and `view: "auto" | "world" | "face" | "mirror" | "tv"`:

- `auto` (default): the attract screen's face pane becomes the **world view**
  whenever a program is in the simulation, and the face comes back when
  nobody is (and always while piloting — the face is the voice).
- `world`: the world view always on the attract screen.
- `face`: today's terminal.
- `mirror`: a full-screen spectator: no scanner, no chat.
- `tv` (`Tv.tsx`, OCT31 K-18): the TV above the fireplace, run by the house
  Mac's Chrome over HDMI — the character's face speaking every line it says
  in the TV's room (`room=`, default The Desktop) in the Mac's own voice
  (the server's `/api/mod/tts` is an opt-in);
  song beats and lore speakers are captioned only, nothing is said while
  the character is hidden or asleep.

Every view polls the lean screen state (`GET /e/:id/api/screen/state`,
`core/server/routes/screen.ts`; every 2 s, the TV every 1 s) instead of
the mod feed: the screen cues, attract mode (the character hidden or asleep → screensaver /
ads, never "ONLINE", no pass piloting), the countdown, the TV's lines, and a
heartbeat the editor's Run → Terminals card reads. A tablet without
**WebGL2** (probed once at boot, `terminal/src/webgl.ts`) behaves as
`face` and never loads three.js; a `mirror` shows a still notice.

The world view shows the King too — `buildHouseScene` draws every `king`
prop standing (no health bar — the bar is drawn by the tablet's own
`setHp`), and a closed leaf in each guarded door — but a terminal never
fights him and never opens the door:
it only watches (the fight is the tablet's own, per session, §3).

The world view (`terminal/src/world/`) renders through `@loom/house/three`
with one camera, cut by a pure director (`world/director.ts`): **mount**
(the camera at the terminal's spot, looking along its yaw/pitch, with the
spot's *vertical* `fov` or `DEFAULT_SPOT_FOV` — a window into the virtual
copy of this very room) while a player is in the terminal's room; else
**follow** (over the shoulder of the most recently active player, with
their room named); a corner **mini-map** of the floor with every player's
dot and the terminal's cone `horizontalFov` wide; a `duck` frame moves
that player's unfound duck on screen; name tags over ghosts; a banner "REINSTALLATION IN
PROGRESS · <name> · <room>"; a celebration on `found`. Rendering is capped
at 30 fps and pauses when hidden; poses are interpolated ~120 ms behind.
Provision: `/terminal/?code=…&name=Kitchen&character=Trabolta&spot=start-bar&view=auto`.

## 5. The VR game — `reinstall/vr/` (Godot 4.7, Quest 3)

- `project.godot`: OpenXR on, XR shaders on, Mobile renderer, ETC2/ASTC,
  `startup_alert=false`, physics 90 Hz; `export_presets.cfg` "Quest" (Gradle
  build, `xr_mode` OpenXR, the Meta vendor plugin for Quest 3, arm64,
  INTERNET permission, no cleartext — the server is HTTPS; built by
  `tools/quest.sh` from a staging copy). Without an OpenXR
  runtime (a Mac) it runs as a desktop game (WASD + mouse) for development.
- `net/server_link.gd` (autoload): config (`res://config/station.json` →
  `user://station.json` → command-line `-- --server … --code … --station …`),
  resolve-code + mod login, station polling (1 s), begin/pose/found/end,
  house fetch with the bundled fallback; HTTPRequest pool; latest-only pose
  pump at 10 Hz. It tracks the map version the server last named (the
  assignment, `hello`, `house`, fetch answers): while the map on screen is
  not that one — the bundled fallback included — it refetches every 2 s
  (one fetch in flight) and the HUD warns that the house may be wrong.
  During a session the map is fetched with the session token, and the
  answer's `duck` is adopted, as is a `duck` frame for this session: the
  duck moves, the trail and the autopilot re-plan, the HUD says "Gerald
  moved — follow the arrows." **Station-poll re-link:** a 404 on the poll
  (the event ended, or the server forgot it) drops back to the lobby and
  re-resolves the passcode to whatever event it names now; no answer at all
  for 5 s shows "Lost the server — retrying…".
- **Found:** the game claims the duck within 0.9 m of it in plan, when the
  feet are within 1.2 m of its height (`HouseDuck.DUCK_MAX_RISE`) or on its
  floor — the server's `nearDuck` rule, tighter in plan.
- `house/house_builder.gd` + `house_geometry.gd` + `house_route.gd` +
  `house_locate.gd`: the §1.2 algorithms in GDScript → StaticBody3D walls,
  floors (with stair holes), ramps, rails, props, terminal screens, labels.
  A `king` prop is drawn as a gold body with a crown (solid, like a box);
  a guarded door is shut for `house_route.gd` as for `route` (never a
  portal); VR draws no leaf — his solid body stands in the gap and nothing
  opens the door.
- **The King is not fought in VR** (U16): within 1.5 m of a `king` prop on
  his floor (`Game.KING_NEAR`) the headset says once per approach "The
  King is fought on the tent tablet." (`KING_NOTICE`, re-armed beyond
  3.0 m, `KING_FAR`); the door he guards stays shut, and no duck is behind
  it.
- `player/`: XROrigin3D rig on a CharacterBody3D; **left stick** walks
  head-relative (dead zone 0.15, 1.8 m/s), **right stick** snap-turns 45°
  (re-arm under 0.3; `smooth_turn` setting); comfort vignette while moving;
  room-scale head offset folded into the body. No buttons are needed
  anywhere.
- `game/`: lobby (a dark room: "Scan your pass on the tablet" + a joystick
  picker of candidates — up/down chooses, hold right 1 s to confirm),
  play (duck, indicator trail, ghosts), found (egg, flight, "Reinstallation
  complete"), back to lobby. Headset off (`user_presence_changed`) ends the
  session after a 2 s grace; without that extension, losing focus ends it
  after 15 s. The grace runs on the **wall clock**, so a headset that went
  to sleep and is handed on later starts in the lobby, not in the last
  program's game.
- `game/autopilot.gd` (`--autopilot`, dev/CI): walks the §1.2 route —
  which already goes round walls, reflex corners, stair holes, ramps and
  solid props — crossing every door and stair end square-on between
  approach points 0.5 m either side; a leg those points add that the
  route's own Visible test refuses detours over that room's corner
  waypoints. Re-plans after 3 s without headway and when the map or the
  duck changes.
- `test/run.sh` + `test/game.gd`: headless checks, including the §1.2
  goldens (every fixture's, at 1e-3), the link over a fake transport (map
  refetch, duck adoption), the found rule, and the autopilot reaching
  every show duck spot kinematically and with real collision.

## 6. The story

The goose is now the **golden duck** (`INTERACTION the golden duck`,
`CODEX The Golden Duck`) and nothing needs a button: "walk to the duck".
`the simulation completed` still releases a corrupted program; the
games fire both events for whoever finds the duck.

**The King** (§3) speaks to the story through `POST /api/mod/signal
{name, subject, label}` with the tablet's moderator token: `chess won`
(the mate), `chess lost`, `chess drawn`, `subject` = the program playing.
The server honours `label` only when the caller's `by` is the generic
"Director" — a mod-token device, never an author's session — and journals
the signal `by` that label (the same rule as `/api/mod/impersonate`), so
the journal line reads `by: "Tent tablet"` (the recap carries no `by`).
The story is unchanged: `when
chess_won:` keeps its Y2K gate (`Night.step >= 14` → the 90 s
`Kernel.disarmed_until` window; before it, `# hosts` says the win is
practice), `chess lost` / `chess drawn` disarm nothing and, from the Y2K
hour while the door is still locked, make Trabolta gloat (`-> Chess Lost`
/ `-> Chess Drawn`, a `# hosts` readout — before that they are silent),
and the fallback stays: **♟ They beat the machine** on the
winner's card (`beat_the_machine` → `fire chess_won`), the admin
`chess_won` INTERACTION, or the director firing `chess won` from Run.
