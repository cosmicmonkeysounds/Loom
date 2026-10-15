# Reinstallation — the golden-duck games and the spatial terminals

*Trapped in the Internet*, 2026-10. Status: **design contract** (this file
is normative for every piece below; when code and this file disagree, fix
one of them in the same change).

A program that the Antivirus drags into **The Internet** (the tent behind
the Tube) is *reinstalled* by proving, in a simulation, that it can follow
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
  location?: string;            // the Loom LOCATION it is in the story ("The Cache")
  poly: Vec2[];                 // rectilinear (every edge axis-aligned), ≥ 4 vertices, simple, either winding
  height?: number;              // default: its floor's height
  outdoor?: boolean;            // no ceiling; unshared edges become a fence
  color?: string;               // "#rrggbb" — floor tint
}
interface Door { id: string; a: string; b: string | null; at: Vec2; width: number; height?: number }
//   a door is a gap in the wall between rooms a and b (b = null: to the outside) on a's floor;
//   `at` lies on the shared wall line (± 0.02 m).
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
  id: string; room: string; kind: "box" | "cylinder" | "screen" | "label";
  pos: Vec3;                    // centre of the base
  size: Vec3;                   // [w (x), h (y), d (z)] before yaw
  yaw?: number; color?: string; label?: string; solid?: boolean;   // solid: collides (default true for box/cylinder)
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
  on the same line (lines within 2 × 0.02 m).
- **Stairs:** an unknown room; a rect that is not `x0 < x1`, `z0 < z1` by
  at least 1 mm; `from` and `to` on one floor, or `from` not the lower; a
  rect not inside both rooms; less than 0.3 m (`STAIR_CLEARANCE`) of `to`
  beyond the head (the `up` edge) or of `from` beyond the foot; a stair
  that passes a floor between its two where a room of that floor overlaps
  the rect (that floor would get no hole).
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
`location` names no `LOCATION`.

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
   - *Portals*: every door (its point at room `a`'s floor elevation; rooms
     `a` and `b`, or just `a` when `b` is null), then per stair the *foot*
     (centre of the edge opposite `up`, lower elevation, room `from`) and
     the *head* (centre of the `up` edge, upper elevation, room `to`).
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
     `solid`, else true for `box` / `cylinder`) and whose `room` exists, the
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
> show's Rec Room, which wraps round the tent, now turns at the tent's
> north-west corner (`[1.15, −2.7, 6.85]`) instead of running through its
> south wall — and no leg crosses a stair hole or its rails, or the ramp
> footprint below, and no leg runs through a solid prop's grown bounds —
> the Rec Room's route from the tent flap to the furnace now turns at the
> ping-pong table's north-east waypoint (`[4.22, −2.7, 7.888]`) instead of
> crossing the table. Doors are walked through at their centre point; legs
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
  a **placeholder layout** (plausible rooms for the show's LOCATIONs) until
  the real house is measured. Edit it with the **map editor**
  (`/reinstall/map`) or by hand.
- The event server serves the event's map: the director's saved one
  when there is one (and it validates) — `STATE_DIR/<eventId>/spatial-house.json`,
  or `STATE_DIR/spatial-house.json` for the default (env-passcode) event,
  which journals to the state-dir root — else the show's file (env
  `LOOM_HOUSE` overrides the default path). The save is deliberately
  *not* named `house.json`: `LOOM_HOUSE` may well be `/data/house.json`
  and the default event's state dir that same `/data`. Mount an override
  read-only, outside the state dir, all the same.
- The show's file is re-read whenever its **mtime** changes (a hand edit,
  a file mounted after boot): while an event runs on the show's file, a
  changed valid file replaces its map and is announced (`house` frame,
  live ducks follow, §2.2). A missing, half-written or invalid file is
  logged once and never sticks — the last good map keeps serving. An
  event running on a director's save never follows the show's file.
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
locate = `[{p, floor, room, height}]` with `height = heightAt([x, z], y)`.
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
| `GET /api/spatial/house` | mod token (header or `?token=`), author session, or a session token | — | 401 none of those · 503 no map · `{house, version, source: "event" \| "show", duck?}` — `duck` (the session's current `DuckSpot`) only when the caller is a live session token: a map save may have moved or re-dealt it, and this is how a parked assignment (not on the stream yet) learns of it |
| `POST /api/mod/spatial/house` | mod | `{house, base?}` — `base` = the version the editor loaded | 400 `{error, problems}` (checked first) · 409 `{error: "the map changed — reload", version}` when `base` is given and is not the current version (the map is loaded first if nothing has yet; no / null `base` = no check, last write wins) · 200 `{ok, version, warnings}`; persists `spatial-house.json` in the event's state dir (§1.3); streams get `house {version}`, then a `duck` frame per player whose duck moved (§2.2) |
| `POST /api/mod/spatial/begin` | mod | `{guest, world: "vr" \| "web", device, station?}` | 409 no scenario · 404 unknown guest · 400 bad world · 503 no map · 200 `Assignment` (below). An active session for the same guest is ended (`leave {reason: "replaced"}`). With `station`, the assignment is parked for that station until it claims it, and an older assignment still parked there is ended (`replaced`). |
| `GET /api/mod/spatial/station` | mod | `?id=vr-1&name=Headset 1&world=vr` | marks the station seen; `{assignment: Assignment \| null}` — the newest unclaimed assignment for it |
| `GET /api/mod/spatial/stations` | mod | — | `{stations: [{id, name, world, online (seen < 5 s), busy: {session, guest, name} \| null}]}` |
| `GET /api/mod/spatial/candidates` | mod | — | `{players: [{id, name, captured, location}]}` — every guest/persona, captured first then by name |
| `POST /api/mod/spatial/end` | mod | `{session}` | `{ok}` |
| `POST /api/spatial/pose` | session token (`x-loom-token`) | `{p: Vec3, yaw, pitch?, t?}` (≤ 2 KB body, read before the generic 4 MiB parse); `p` is the player's **feet** (the floor point under the body — the eye is 1.6 m above it), `yaw` the view direction, `pitch` the head (degrees, + = up) | 204 · 400 malformed · 401 unknown token · 410 session over (the last 1000 ended tokens are remembered). First pose **claims** a parked assignment — and ends any *other* session on that station (`leave {reason: "replaced"}`: a headset that crashed mid-game never ended its last one). Poses (and the stream) **ignore pause**: they never touch the story. |
| `POST /api/spatial/found` | session token | `{}` | 401 / 410 as for poses · 409 `{error: "doors are closed"}` while the event is not open (paused, or before the doors open) — the session stays un-found, so the game's retry lands after resume · 409 `{error: "this session has not started — send a pose first"}` for a parked assignment no pose has claimed · 409 `{error: "not near the duck", distance, dy}` unless the last pose is within 2.0 m (plan, `FOUND_PLAN_M`) of the duck **and** either within 1.2 m of its height (`DUCK_MAX_RISE`; a pose is the feet) or on the same floor (`floorOf`) — `nearDuck` · 200 `{ok, released, already}`; commits `signal("the simulation completed", guest)` then `signal("the golden duck", guest)`, journaled `by` the session's `device`, and appends the run (`DuckRun`: guest, name, world, device, `ms` from the begin — or a parked assignment's claiming pose — to the find) to `spatial-runs.jsonl` in the event's state dir, which `/api/mod/recap`'s `duck` board reads (cleared by a story restart). A repeat answers `already` without committing. |
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

**A new map mid-game** (a director's save, or a changed show file):
`setHouse` keeps every live session going. One that hasn't found its duck
keeps its spot **id**, so a moved room carries the duck along and the
session takes the spot's new position; a spot the new map no longer has
is re-dealt (`pickDuckSpot`, still avoiding the one this guest found
last). Rooms and floors are recomputed (the next `poses` flush carries
them), a parked assignment moves to the new spawn, and every session's
`houseVersion` becomes the new one. Then `house {version}`, then the
`duck` frames above.

## 3. The web game — `reinstall/web/` (`loom-reinstall`)

React shell + three.js canvas. Screens: **setup** (moderator passcode,
device name, role) → **scan** (camera via the terminal's `Scanner`, typed
name fallback via `candidates`) → for a scanned program, **Play here** or
**Send to <station>** (online VR stations listed) → **play** → **found**
(the duck lays a golden egg and flies; "Reinstallation complete" or, for a
program that wasn't corrupted, "You found Gerald") → back to scan.
Provisioning link: `/reinstall/?code=<mod>&name=Tent tablet`.

Play: first-person, eye height 1.6 m, walk 1.8 m/s (run ×1.6 with Shift),
circle-vs-wall collision (radius 0.25) against `buildWalls` segments whose
vertical span overlaps the body, `heightAt` for floors and stairs, solid
props as boxes, and head clearance: a floor or ramp surface strictly
between step-up (0.45 m) and body height above the feet refuses the move,
so the walker slides along the underside of a stair instead of walking
into it. Controls: left on-screen stick = move, right stick = turn
(x) and look (y); keyboard WASD/arrows/QE/Shift; mouse drag to look. The
indicator trail (`route` → golden chevrons every 0.75 m, refreshed twice a
second), a compass/room HUD, the duck (bobbing, glowing, quacks via
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

The **map** page (`/reinstall/map`): the house plan (SVG, one floor at a
time), live players, the duck of each session, terminals with their view
cones; an **editor** for directors (drag terminals / duck spots / the spawn,
nudge yaw, add/remove terminals and duck spots, move/resize rectangular
rooms, edit the JSON with live validation) saving through
`POST /api/mod/spatial/house` with `base` = the version it loaded (none
for the bundled stand-in, which is read-only anyway). A 409 saves nothing
and offers **Copy my edits (JSON)** and **Reload the map**; a successful
save moves the page's base to the new version. A terminal's view cone is
drawn `horizontalFov(fov ?? 70)` wide (§1.1). A terminal's provisioning
link is offered from its row.

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
  in the TV's room (`room=`, default The Desktop) through `/api/mod/tts`;
  song beats and lore speakers are captioned only, nothing is said while
  the character is hidden or asleep.

Every view polls the lean screen state (`GET /e/:id/api/screen/state`,
`core/server/routes/screen.ts`; every 2 s, the TV every 1 s) instead of
the mod feed: the screen cues, attract mode (the character hidden or asleep → screensaver /
ads, never "ONLINE", no pass piloting), the countdown, the TV's lines, and a
heartbeat the editor's Run → Terminals card reads. A tablet without
**WebGL2** (probed once at boot, `terminal/src/webgl.ts`) behaves as
`face` and never loads three.js; a `mirror` shows a still notice.

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
Provision: `/terminal/?code=…&name=Kitchen&character=Trabolta&spot=kitchen&view=auto`.

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
