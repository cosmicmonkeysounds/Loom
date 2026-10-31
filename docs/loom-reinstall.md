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
| **VR** | Quest 3 headset(s) in the tent | thumbsticks: left stick walks (head-relative), right stick turns (smooth only, gentle near the centre); the trigger (or A / X) hits the King | `reinstall/vr/` — Godot 4.7 project, OpenXR |
| **Web** | the tent laptop (`view=reinstall` on the terminal), or a spare tablet / laptop at `/reinstall/` | on-screen twin joysticks (touch) **and** keyboard (WASD/arrows walk, Q/E or ←/→ turn, mouse-drag look); ⚔ HIT or Space hits the King | `reinstall/web/` — Vite + three.js app `loom-reinstall`, served at `/reinstall/` |

Both games stream the player's **pose** to the event server. Every
**terminal** (the wall tablets, `terminal/`) receives that stream and shows
the players exploring the virtual house — through a virtual window placed
exactly where the terminal hangs on the real wall. In both games the
**King** guards the virtual server-room door with one health bar shared
by every guest; the chess he plays for the real door's code is on the
**Server Door** terminal outside the real door (§3, §4).

```
 pass QR ──scan──▶ web game / tent laptop ──POST /api/mod/spatial/begin──┐
                                                                          ▼
 Quest 3 ──poll /api/mod/spatial/station──▶ assignment          SpatialHub (event server)
 Quest 3 / web ──POST /api/spatial/pose (10 Hz, house frame)──▶   │  ├─ journal: only the story outcome
 game ──POST /api/spatial/found──▶ signal "the simulation completed" + "the golden duck"
 game ──POST /api/spatial/king/hit──▶ set Night.king_hp − 1 + signal "king hit" (+ "king fallen" at 0)
 game ──POST /api/spatial/moment──▶ signal "simulation escape attempt" | "… heart reached" | "… pickup taken"
                                                                  ▼
 terminals ◀── SSE /api/spatial/stream (poses 10 Hz, hello/join/leave/found/house/duck/reset/king/avatar)
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
interface TerminalSpot {
  id: string; name: string; room: string; pos: Vec3; yaw: number; pitch?: number; fov?: number;
  view?: "auto" | "world" | "face" | "mirror" | "tv" | "chess" | "shadow" | "casino" | "reinstall";   // TERMINAL_VIEWS; unset: auto
  speaks?: boolean;             // a room terminal (speaks its room's LOCATION's lines); unset: false
  voice?: boolean;              // the voice link (§2.4); unset: on, except a terminal in the spawn room (off) — voiceOn
}
//   pos = the screen's centre on the real wall; yaw = the direction the screen faces (into the room);
//   pitch = the mount camera's pitch, degrees (+ = up; unset: the terminal's default, a little down);
//   fov = the mount camera's VERTICAL field of view in degrees, exactly three.js's PerspectiveCamera.fov
//   (Godot: Camera3D.fov with the default keep_aspect = KEEP_HEIGHT); unset = DEFAULT_SPOT_FOV = 70.
//   The horizontal fov depends on the screen: horizontalFov(vfov, aspect = 16/10) =
//   2·atan(tan(vfov/2)·aspect) — ≈ 96.5° for the default on a 16:10 wall tablet.
//   view = what a tablet set up on this spot shows; speaks = it sleeps until its room's LOCATION is open
//   to everyone, then speaks the lines said there. voice: true → in the voice link, false → out; unset →
//   in, unless `room === spawn.room` (the tent / the shed: the tent laptop and the headsets). The server
//   refuses and never routes a spot that is out; both show maps also set `voice: false` on `tent`.
interface DuckSpot { id: string; room: string; pos: Vec3 }   // pos = where the duck sits (its feet)
interface Prop {
  id: string; room: string; kind: "box" | "cylinder" | "screen" | "label" | "king" | "heart" | "pickup";
  pos: Vec3;                    // centre of the base
  size: Vec3;                   // [w (x), h (y), d (z)] before yaw
  yaw?: number; color?: string; label?: string; solid?: boolean;   // solid: collides (default true for box/cylinder/king)
  hp?: number;                  // king only: his MAXIMUM hit points, one shared bar per event (1–99, default 4)
  health?: string;              // king only: the story world path holding his CURRENT hit points ("Night.king_hp");
                                //   absent = the spatial hub counts them in memory, starting at `hp`
  item?: string;                // pickup only, and required there: what it is ("virus"), the moment's `item` arg
  model?: string;               // (wave 47) box / cylinder only: what it is drawn as (`PROP_MODELS`: "wall",
                                //   "cabinet", "rack", "crt", …); drawing only, it collides as its plain shape;
                                //   an unknown well-formed id draws plain
  neon?: string;                // (wave 47) a model's neon colour, "#rrggbb" (default: the model's)
  from?: number;                // (wave 49) only there at this descent level and deeper, in the games alone; never solid
  talk?: string;                // (wave 49) a talker id in `descent.json`, or "none"; absent: by model
  signals?: { won?: string; lost?: string; drawn?: string; hit?: string; fallen?: string; reached?: string; taken?: string };
                                // the story signals a prop posts, keys checked per kind: a king's won / lost /
                                //   drawn (the chess terminal) and hit / fallen (the server; defaults "chess won" /
                                //   "chess lost" / "chess drawn" / "king hit" / "king fallen"); a heart's `reached`
                                //   ("simulation heart reached"); a pickup's `taken` ("simulation pickup taken")
  armed?: { path: string; min: number };   // king only: a checkmate counts while the world var at `path` is
                                //   a number ≥ `min` (the screen state's `king.armed`); absent = unknown
}
interface SpaceTransform { offset: Vec3; yaw: number; scale: number }
interface KingState { id: string; hp: number; max: number; fallen: boolean }   // fallen ⇔ hp ≤ 0
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
- **The King:** `hp` not an integer 1–99 (`KING_MAX_HP`), `health` not a
  world path (identifiers joined by dots), `armed` not `{path, min}`; any
  of the three on a prop that is not a `king`.
- **Signals, the heart and pickups** (wave 26): `signals` keys not of the
  prop's kind (`PROP_SIGNAL_KEYS`: a king's `won / lost / drawn / hit /
  fallen`, a heart's `reached`, a pickup's `taken`; any other kind takes
  none) or not non-empty strings; a `pickup` with no `item`, or an `item`
  on any other kind; a `label` on a heart or a pickup (an older game would
  draw it). An older server or bundle refuses both new kinds, so the
  server ships before a map that has them.
- **`from`** (wave 49): an integer 1–4 on a `box` or `cylinder`. `propSolid`
  is false whatever else it says, `solid: true` is refused, and no wall,
  route, locate or terminal sees it: it exists only in a game whose walk runs
  at that level or deeper. `talk` is a well-formed talker id or `"none"`; one
  naming no talker in `descent.json` draws a warning in the map editor.
- **Models** (wave 47): a `model` that is not a lowercase id
  (`PROP_MODEL_PATTERN`), a `neon` that is not `#rrggbb`, or either on a
  kind other than `box` / `cylinder`. An older server ignores both fields
  and an older game draws the plain shape, so a map with models needs no
  deploy order.
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

**The King** (`king.ts`, wave 11). One shared health bar per event: the
prop's `hp` is his maximum (`kingMax`, default `KING_HP` = 4), his current
points live in the story world var `health` names (else in the hub), and
`kingStateOf(king, raw)` reads a raw value as `KingState` (missing or not a
number → full; rounded, clamped to `0..max`; `fallen` ⇔ `hp ≤ 0`).
`kingSignal(king, which)` is the prop's signal or `KING_SIGNALS`'
default. **`kingReach(house, feet, yaw, king, slack?)`** is the one hit
rule, in order: another floor (`floorOf` of the two heights) → `"floor"`;
plan distance feet → his base centre over `KING_REACH` (1.25 m) → `"far"`;
the plan bearing to him more than `KING_CONE_DEG` (55°) off `yaw`
(`wrapYaw`) → `"facing"`; else `"ok"` (standing on his very centre counts
as facing). `slack` widens both; the server judges with `KING_HIT_SLACK`
(+0.35 m, +25°), since the pose it reads is the 10 Hz latest-only one.
Cooldowns and his falling are the server's, not this rule's.
`withFallenKings(house, fallen)` is the map a fallen King leaves: a copy in
which every door a king in `fallen` guards loses its `guard` and those
kings are `solid: false` (an empty set, or one naming no king, returns
`house` itself).

**The moments' rules** (wave 26; `escape.ts`, `moment.ts`, `presence.ts`;
the server judges with them and both games pre-check with them):

- **The void.** `outsideGround(house)` is the walkable outside: the floor
  the first exterior (`b: null`) door opens from, its elevation and the
  bounds of that floor's rooms grown by `OUTSIDE_GROUND_MARGIN` (30 m; VR's
  `_build_ground`), with the rooms as holes. `voidDistance(house, p)` is
  null in a room, else the plan distance to the nearest room boundary on
  `floorOf(p[1])` (`Infinity` on a floor with no rooms). An escape is
  `ESCAPE_M` (5 m) out; the server accepts `ESCAPE_M − ESCAPE_SLACK`
  (4.5 m) and one per session per `ESCAPE_COOLDOWN_MS` (20 s).
- **The heart.** `heartReached(house, feet, heart)`: in the heart's room
  (`locate`) and at least `HEART_INSET_M` (0.3 m) inside its polygon.
- **A pickup.** `pickupReach(house, feet, prop, slack?)`: on its floor,
  within `DUCK_MAX_RISE` of it in height and within `PICKUP_REACH_M`
  (0.9 m) + `slack` of its base centre in plan; the server passes
  `PICKUP_SLACK_M` (0.3 m). `momentProp(house, id, kind)` finds the prop,
  `propSignal(prop)` its signal.
- **Presence.** `presenceRoom(house, p, prev)` is the room a player counts
  as being in for the terminals' link (§2.3, §2.4): `locate`'s room, except
  that the player stays in `prev` while still inside its polygon, within
  `PRESENCE_HYSTERESIS_M` (0.75 m) of the gap of a door joining `prev` and
  the new room (null: outside), or over a stair joining them. It never
  holds through a solid wall. `linkedSpots(house, rooms)` names the map
  terminals in any of those rooms, never a `view: "reinstall"` one (the
  tent: every walk starts in its room). `PRESENCE_LINGER_MS` (3 s) is a
  client-side latch only.
- **The path reveal.** `PATH_REVEAL_MS` (60 s): both games hide the way to
  Gerald for the first minute of each session (§3, §5).

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
     `route(house, from, to, {fallen})` routes over
     `withFallenKings(house, fallen)`: once the shared King is down his
     doors are portals and he is no obstacle. Both games route their trail
     that way while he is fallen (reinstall/web `trailMap`, VR
     `house_king.gd`), and keep doing so for a player a restore would shut
     in (§3 *The King*): once he is down a player can be behind his door,
     and a trail from there over the map as it is would cross a wall.
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
  drawn from the real house in the map editor (2026-10-20; the older
  placeholder maps are frozen in `house/test/maps/`), with the story's
  structure: every LOCATION has a room, the
  tent (The Internet: the spawn, the station mats, the `tent` terminal) is
  an indoor room in a notched backyard, the Server Room has a door and no
  duck. Since wave 26 the Server Room holds Trabolta's heart (a `heart`
  prop) and the Hard Drive the virus disk (`pickup` prop
  `virus-disk`, `item: "virus"`); neither has a label or `signals`, and
  `house/test/show.test.ts` keeps the disk ≥ 2 m from every duck spot and
  clear of every trail on both maps. Edit it with the **map editor**
  (Run → House → 🗺 Map, which places, moves and edits both new kinds) or by hand.
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
- **The house's other project files** ride the same row record and the
  same rules, each on its own `sync-example` switch: `facts.json` (the
  judge's key, always the example's), `audio.json` (the speakers,
  `--replace-audio`), `lights.json` (§1.4, `--replace-lights`) and, wave 25,
  `desk.json` (the house desk's cue list, `--replace-desk`;
  [`loom-house-desk.md`](./loom-house-desk.md)). None is part of
  `house.json`: an edit to one never bumps the map version.
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
- **The house speakers are not in the map** (wave 17, decision D5). They
  live in the project file **`audio.json`** (`@loom/house` `AudioConfig`,
  `validateAudio`, `resolveTargets`; `house/src/audio.ts`): the audio
  interface (16 in / 16 out), its routing matrix, the speakers (each on a
  `house.json` room id with a position and its outputs), zones, and where
  each story sound plays. A speaker edit or a re-patch mid-show never bumps
  the map version (which would remap every game), and the tent and shed
  variants share it — one physical house. Never name it `house.audio.json`
  (that reads as a map variant). It is snapshotted at launch beside the
  maps, a director's save from the map editor's Audio panel wins over it,
  `LOOM_AUDIO` is the LAN fallback, and `sync-example` merges it like a
  map with its own `--keep-audio` / `--replace-audio`. Routes: `GET | POST
  /api/mod/audio`, `POST /api/mod/audio/{project,test}`
  (`core/server/audio.ts`); the stagehand `audio` router (John's Windows
  Desktop; John's MacBook only in the fallback) reads
  it — [`docs/trapped/room-audio.md`](./trapped/room-audio.md) §11.
- **The house lights are not in the map either** (wave 20, §1.4).

The shared code is the pure-TS package **`@loom/house`** (`house/`, no
dependencies): schema, `validateHouse`, `buildWalls`/`buildFloors`/
`buildRamps`, `locate`/`roomAt`/`floorOf`/`heightAt`, `route`, space
transforms, `pickDuckSpot`, the King (`kingReach`, `withFallenKings`,
`kingStateOf`) and the wave 26 moments and presence (§1.1). Its subpath **`@loom/house/three`** (peer dependency
`three`) turns a map into a three.js scene: walls, floors, ceilings, ramps,
rails, props, terminal screens, room labels; the duck model; the King
(`createKing`: his bar, a stagger, `kneel`; `HouseScene.showKing` shows a
`KingState` and hides his doors' leaves while open); Trabolta's heart
(`createHeart`: a dark rack with a slowly beating core and no labels,
always built, shown only while every King on the map has fallen); a
pickup (`createPickup`: a spinning, bobbing floppy with a green glow,
built only with `pickups: true`, which only the games pass;
`HouseScene.setPickupTaken` hides one); the outside ground (`ground:
true`, the games only); the indicator trail;
player avatars (ghosts with name tags: a glitchy swarm of the guest's own
profile picture, `swarm.ts`, one instanced draw per ghost, holding to the
capsule the body would fill, which is never drawn, and tearing into a face
that stares at the camera; static in the ghost's tint with no picture:
`createAvatar(name, seed, {picture})`, `setPicture`, the `loadPicture` cache
— a fixed draw size so a sizeless SVG renders, one texture per URL, a
failure retried after `PICTURE_RETRY_MS` 60 s). The web game and the
terminal both render through it, so they always look alike; VR draws the
same swarm (`game/swarm.gdshader`), the raycaster a small one in Canvas 2D.

Golden fixtures for the Godot port: `house/test/golden/<name>.walls.json`,
`.routes.json`, `.locate.json`, generated by `pnpm --filter @loom/house
goldens` from `house/test/fixtures/*.json` + the show's `house.json`
(`name` = `show`). Each is a JSON array, one value per line, every number
rounded to 1 mm: walls = `WallSegment[]`; routes = `[{from, to, path}]`;
locate = `[{p, floor, room, height, standable}]` with `height = heightAt([x, z], y)` and `standable = standable(house, p)` (the queries include every solid prop's base and top). A map with a king also gets `<name>.king.json` = `[{king, feet, yaw, reach, slack}]` (`kingReach` plain and with `KING_HIT_SLACK`, feet on 8 bearings at 0.4 / 1.2 / 1.4 / 1.7 m facing him and 50° / 70° / 90° / 180° off, plus a point on every other floor) and `<name>.fallen.json` = the route queries again with every king fallen; today only `show` has a king.
Wave 26 adds, per map, `<name>.escape.json` (`outsideGround`, then
`voidDistance` queries) and `<name>.presence.json` (`presenceRoom` either
side of every door, along each door's wall past its gap and over each
stair, then `linkedSpots`); a map with a heart or a pickup also gets
`<name>.moments.json` (`heartReached`, `pickupReach` plain and with
`PICKUP_SLACK_M`); and once, `constants.json` with every new constant.
Queries are stored with their answers, so a port only reads and compares.
A test fails when the committed goldens drift from the code.

### 1.3b The descent — `descent.json` (wave 49)

The words of the descent (contract `docs/loom-w49-contract.md`; rules
`house/src/descent.ts`, schema `validateDescent`). A project file like
`credits.json`: read live (the project's, else `LOOM_DESCENT`, else, with no
project, the scenario's own), never journaled or snapshotted, always replaced
by `sync-show`, linted by `loomcheck`. VR keeps a copy
(`reinstall/vr/house/descent.json`, `pnpm house:sync`) for a server with none.

A walk's **level** is the ducks its program found before it, capped at 4, or a
level a director forced. Level 0 is the clean game. The level seeds a plan of
**visions** (`descentPlan`, the session id its seed) and wakes **talkers**
(`wakeTalkers`): props with a face that speak to a program within reach and
offer up to four options. Nothing here touches the server's judgement: a
vision never blocks a find or a hit. The one thing kept is what a program told
a talker (`POST /api/spatial/told`), in memory, so a later visit can open
differently (`openNode`).

**Footsteps** are the same idea as §1.4's presence, for `audio.json`: see
`house/src/footsteps.ts` and §2.

### 1.4 House lights — `lights.json` (wave 20)

The lights the story drives live in the project file **`lights.json`**
(`@loom/house` `LightsConfig`; `house/src/lights.ts`), beside `audio.json`
and for the same reasons: placing a bulb mid-show never bumps the map
version, and both map variants share one physical house. Never name it
`house.lights.json` (that reads as a map variant).

- **Fixtures**: a Zigbee bulb (`kind: "zigbee"`, `device` = its
  Zigbee2MQTT friendly name), a Z2M group (`zigbee-group`) or a WLED strip
  (`wled`, `device` = its base topic, e.g. `wled/living`), each on a
  `house.json` room id with a position in the **absolute** house frame
  (metres, Y up: the basement ceiling is at −0.6), what it can do (`caps
  {color, ct, dim}`) and, for a **safety** fixture, a floor
  (`LIGHT_SAFETY_MIN` 40 / 254, a hard floor; a higher `min` raises it, a
  lower one has no effect and is a warning). A safety fixture is never OFF and never
  below its floor: `validateLights` refuses a look written that way, and
  `clampForSafety` lifts anything that reaches it anyway.
- **Zones** name groups of fixtures. **Targets** (`resolveLightTargets`,
  folded like the speakers' — case, `_` / `-` and spaces don't matter):
  `everywhere`, a fixture id, a zone id or name, a room id, and with a house
  a room's label or a LOCATION.
- **Looks** are keyed by the story's cue name: `cue heart_wake` plays
  `looks.heart_wake` (a look name is `^[a-z][a-z0-9_]*$` and never starts
  with a screens cue family: `screens_`, `terminals_`, `tv_`, `tablet_`,
  `room_`). A look is one command (`set`) or timed `steps` (`at` ms, each
  with an optional narrower `to`), in Zigbee2MQTT's words (`state`,
  `brightness` 0–254, `color` `#rrggbb` or `color_temp` 150–500 mireds,
  `effect`, `transition` s); played once, `repeat` N times, in a `loop`
  until the next look, or once and then **giving the light back**
  (`then: "restore"`: the loop it interrupted restarts, else each
  fixture's settled state is re-published; it never becomes the settled
  state). Zigbee bulbs drop fast commands and flicker badly, so steps on one
  fixture are ≥ `LIGHT_STEP_MIN_MS` 150 apart (≥ `LIGHT_COLOR_STEP_MIN_MS`
  400 for a colour change: a refusal) and a loop under
  `LIGHT_LOOP_MIN_PERIOD_MS` 1.5 s on Zigbee is a warning. `boot` names the
  look the module plays on start and after a story reset.
- `planLook` expands a look into timed, cap-filtered, safety-clamped
  commands; `z2mPayload` (topic `zigbee2mqtt/<device>/set`, `color` as
  `{hex}`) and `wledPayload` (topic `<device>/api`: `on`, `bri`,
  `transition` in tenths, one segment's `col` / `fx`) build what goes on
  MQTT. stagehand's `lights` module mirrors routing, plans and payloads in
  Python, pinned byte for byte by `house/test/fixtures/lights-{basic,house,resolve,plan}.json`.
- **Where it lives** (`core/server/lights.ts`, the audio rules): snapshotted
  at launch beside the maps (the event row's `house_maps` record, key
  `lights.json`; `project-lights.json` in the state dir), a director's save
  from the map editor (`lights-save.json`) wins over it until **Save to
  project**, `LOOM_LIGHTS` is the LAN fallback (re-read on mtime, the last
  good file kept), else nothing is placed. A project PUT of a broken
  `lights.json` answers 400 `problems`; `/api/mod/load {lights}` takes a
  fresh snapshot; a reload (Push draft) picks up an edit and the event reads
  stale until then; `sync-example` merges it like a map with its own
  `--keep-lights` / `--replace-lights` (never the map or audio switches),
  and `scripts/sync-show.sh` passes them through.
- **Routes** (a mod token or the author's session; never a host's booth):
  `GET /api/mod/lights[?after=&tests=&pairs=&devicesAt=&wait=&module=1&name=]` (the
  config, the story's cue names that can be looks, LOCATIONs, recent tests,
  the open pairing, the Z2M devices, the module's presence, problems /
  warnings against the house in force; with `after` a long poll that wakes
  on a save, a snapshot, a test, a pair or a new device list, and answers at
  once when the device list is newer than `devicesAt` — send the last
  view's, so a list posted between two polls is never parked on), `POST
  /api/mod/lights {lights, base?}` (400 `problems`, 409 `stale`), `POST
  /api/mod/lights/project`, `POST /api/mod/lights/test {fixture} | {look} |
  {fixture, set}` (identify, play a look, publish one state; 400 `set does
  nothing` for a set with no field but `transition`), `POST
  /api/mod/lights/devices {devices}` (the module's reduced
  `zigbee2mqtt/bridge/devices` + `groups`, ≤ 500, ≤ 256 KB), `POST
  /api/mod/lights/pair {seconds}` (Z2M permit-join; 0 closes, and a close
  rides the GET for 60 s so the module sends it). Tests, pairs and devices
  are memory only.

#### Presence: a program pulses the light it walks under (wave 39)

`lights.json` `presence {enabled?, to?, radius?, effect?}` (`@loom/house`
`presenceSettings`: on, `to: ["everywhere"]`, `radius` 1.6 m, `effect:
"breathe"` by default; the show's is `to: ["rooms"]`) says which fixtures
a program in the reinstallation games may pulse; a **safety** fixture never
does (`presenceFixtures`).

- **The server judges it** (`core/server/spatial.ts`). On every pose flush
  (100 ms, moved or not), a session leaving, a map swap and a story reset,
  `SpatialHub` runs `presenceStep` over its joined sessions (a director's
  `force` walk too): `{session, room: its presence room, p: its feet}`. A
  fixture is under a program when its `room` is the program's presence room
  and its plan distance is ≤ `radius` (+ `LIGHT_PRESENCE_LEAVE_M` 0.6 for
  one already under it); it stays pulsed `LIGHT_PRESENCE_HOLD_MS` 4 s after
  the last one left (the flush loop keeps running for that). A story reset
  is a cut: no pulse is held over it. The hub reads the config through an
  injected getter and tells the runtime when the pulsed **set** changes;
  memory only.
- **The module hears it** on its long poll: `LightsView.presence = {seq,
  fixtures: [{fixture, since}]}` (`since` server ms, the config's file
  order). `seq` moves on with every change of the set (never for the same
  set with new times); `GET /api/mod/lights?…&presence=<seq>` answers at
  once when the server's seq is not `<seq>` (a newer set, or a cursor from
  before a restart) and a parked poll wakes on a change. An older module
  sends no cursor and ignores the field. The module plays the firmware
  effect (one command on arrival, one every `LIGHT_PRESENCE_REPEAT_MS` 12 s,
  `finish_effect` on leaving; `docs/loom-show-control.md`).
- **What the fixtures show**: `POST /api/mod/lights/shown {fixtures: {[id]:
  LightState}}` (a mod token, like `/devices`; never on the host allowlist)
  is the module's model of every fixture, every command it published merged
  like `mergeLightState`, replacing the last report whole. An id the config
  in force lacks, or a state `lightStateProblems` refuses, is dropped (not
  the post); 400 only when `fixtures` is not an object; `{ok: true}`;
  memory only. The games' source (§2.2 `lights`) is `house` while the
  module is online (`LightsView.module.online`) and its report is ≤
  `LIGHTS_SHOWN_FRESH_MS` 30 s old, else `estimate`.
- **The estimate** (`core/server/lights-shown.ts` `LightsEstimate`): per
  fixture, the last look or test that reached it, replayed with `planLook`
  + `previewAt` at `now − start` from what the fixture showed when it
  started (a `then: "restore"` look gives that back). It hears a live
  batch's `cue X` naming a look (never a journal replay), every
  `/api/mod/lights/test` with a `look` or a `{fixture, set}` (a desk cue's
  too; an identify is ignored), and the config's `boot` look: at start as
  long settled (the module played it when it started), and played afresh
  after every story restart (reset, reload, go live). A fixture nothing
  reached shows `LAMP_SETTLED`. The module's report names only fixtures it
  has commanded since it started (colours normalised to lower case); under
  `house` every other fixture is estimated. Memory only: a server restart
  starts again from the settled boot look.

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
| `GET /api/spatial/house` | mod token (header or `?token=`), author session, or a session token | — | 401 none of those · 503 no map · `{house, version, source: "event" \| "project" \| "show", duck?, king?}` (§1.3) — `duck` (the session's current `DuckSpot`) and `king` (the shared `KingState`, null when the map has none) only when the caller is a live session token: a map save may have moved or re-dealt the duck, and this is how a parked assignment (not on the stream yet) learns of both |
| `POST /api/mod/spatial/house` | mod | `{house, base?}` — `base` = the version the editor loaded | 400 `{error, problems}` (checked first) · 409 `{error: "the map changed — reload", version}` when `base` is given and is not the current version (the map is loaded first if nothing has yet; no / null `base` = no check, last write wins) · 200 `{ok, version, warnings}`; persists `spatial-house.json` in the event's state dir (§1.3); streams get `house {version}`, then a `duck` frame per player whose duck moved (§2.2) |
| `GET /api/mod/spatial/variants` | mod | — | `{variants: [{file, name, label?, active, ok, problems}], from: "project" \| "show", edited, project}` — every whole-map variant (the default file first, then by name; `name` = the map's own, else the file; `label` = the map's `variant` field, trimmed, when it has one — the map page's button reads it first), each validated afresh; `from` = the project snapshot, or the show file's siblings when it has no map files; `edited` = a director's save is in force; `project` = the event has a project (Save to project works) |
| `POST /api/mod/spatial/variant` | mod | `{file, base?}` | 404 `{error: "no such map variant", variants}` · 400 `{error: "invalid house map", problems}` · 409 as for `house` on a stale `base` · 200 `{ok, version, warnings, file, dropped}`. **The tent ↔ shed switch** (SW-MAP-13), mid-show too: the same path as a save (live sessions carried over, ducks kept by spot id or re-dealt, `house` then `duck` frames), nothing saved; the active variant is remembered for the event (survives a restart) and on its row (`event.map_variant`, which End → relaunch starts on); a player standing where the new variant has no floor goes back to its spawn (§2.2); `dropped` = a director's save was in force and is gone |
| `POST /api/mod/spatial/house/project` | mod | `{file?, base?}` — `file` default: the active variant's (a show sibling's too, on an event with no project maps yet, when it is named like a map file), else `house.json` | 409 `{error: "this event has no project — download the map instead"}` (the LAN default event; no `version`) · 400 not a map file name · 409 stale `base` · 502 the write failed · 200 `{ok, file, version}`. **Save to project**: writes the event's current map (two-space JSON + newline) as that project file — through the live co-editing doc when it is open, announced to every editor's tree — and records the snapshot on the event row, so the next launch and every co-writer see it. When `file` is the active variant, the director's save it came from is retired (the event now runs on the project's copy; same version, no frame) |
| `POST /api/mod/spatial/begin` | mod | `{guest, world: "vr" \| "web", device, station?, force?}` | 409 no scenario · 404 unknown guest · 400 bad world · 503 no map · **409 `not marked for reinstallation`** unless the guest is eligible — checked before `reinstallation begun` fires, so an unmarked guest never triggers the story; eligible = the story's header `reinstall: <cond>` held for the guest when it declares one (wave 18; the show: marked, corrupted, or after an ending, a party favour), else captured or restricted (wave 16); `force: true` (a director's override; no device sends it) skips the check · 200 `Assignment` (below). An active session for the same guest is ended (`leave {reason: "replaced"}`). With `station`, the assignment is parked for that station until it claims it, and an older assignment still parked there is ended (`replaced`). |
| `GET /api/mod/spatial/station` | mod | `?id=vr-1&name=Headset 1&world=vr` | marks the station seen; `{assignment: Assignment \| null}` — the newest unclaimed assignment for it |
| `GET /api/mod/spatial/stations` | mod | — | `{stations: [{id, name, world, online (seen < 5 s), busy: {session, guest, name} \| null}]}` |
| `GET /api/mod/spatial/descent` | mod (never a host) | — | `{forced: number \| null}` (wave 49), §2.5 |
| `POST /api/mod/spatial/descent` | mod (never a host) | `{level: 0..4 \| null}` | 400 `{error}` · 200 `{ok, forced}`. Forces the level of every **next** deal, mostly to test; null is by visits again. Memory only; a story reset clears it |
| `GET /api/mod/spatial/candidates` | mod | — | `{players: [{id, name, captured, restricted, eligible, marked, favour?, location, avatar, reinstalled}], ended?}` — `eligible` = what `begin` lets in without `force` (the `reinstall:` line, else captured \|\| restricted); `marked` = eligible, not captured, not restricted (wave 18; after an ending every program reads `marked: false` and an eligible one `favour: true`, with a top-level `ended: true`); a duck run found after the night ended is written `after: true` to `spatial-runs.jsonl` and never reaches the recap's duck board; every guest/persona, captured first, then restricted (marked by the story or held by a director, not captured yet), then by name; `avatar` = the profile picture's avatar key or null |
| `POST /api/mod/spatial/king` | mod / author | `{hp}` — an integer 0..max | 404 `{error: "no king"}` · 400 not an integer in range · 409 no scenario · 200 `{ok, king}`: a journaled `set` of the King's `health` path `by` the director (the hub's own count when the prop has no path); the stream gets a `king` frame with `by: null`. The story's 👑 `restore_the_king` does the same to full |
| `POST /api/mod/spatial/end` | mod | `{session}` | `{ok}` |
| `POST /api/spatial/pose` | session token (`x-loom-token`) | `{p: Vec3, yaw, pitch?, t?}` (≤ 2 KB body, read before the generic 4 MiB parse); `p` is the player's **feet** (the floor point under the body — the eye is 1.6 m above it), `yaw` the view direction, `pitch` the head (degrees, + = up) | 204 · 400 malformed · 401 unknown token · 410 session over (the last 1000 ended tokens are remembered). First pose **claims** a parked assignment — and ends any *other* session on that station (`leave {reason: "replaced"}`: a headset that crashed mid-game never ended its last one). Poses (and the stream) **ignore pause**: they never touch the story. |
| `POST /api/spatial/found` | session token | `{}` | 401 / 410 as for poses · 409 `{error: "doors are closed"}` while the event is not open (paused, or before the doors open) — the session stays un-found, so the game's retry lands after resume · 409 `{error: "this session has not started — send a pose first"}` for a parked assignment no pose has claimed · 409 `{error: "not near the duck", distance, dy}` unless the last pose is within 2.0 m (plan, `FOUND_PLAN_M`) of the duck **and** either within 1.2 m of its height (`DUCK_MAX_RISE`; a pose is the feet) or on the same floor (`floorOf`) — `nearDuck` · 200 `{ok, released, captured, already}` (`captured`: the program is still captured after the commit — the story kept them, e.g. the banishment; wave 9); commits `signal("the simulation completed", guest)` then `signal("the golden duck", guest)`, journaled `by` the session's `device`, and appends the run (`DuckRun`: guest, name, world, device, `ms` from the begin — or a parked assignment's claiming pose — to the find, less any time the doors were closed — a pause mid-run is not the player's time) to `spatial-runs.jsonl` in the event's state dir, which `/api/mod/recap`'s `duck` board reads (cleared by a story restart). A repeat answers `already` without committing. |
| `POST /api/spatial/king/hit` | session token | `{}` | 401 / 410 as for poses · 409 `{error: "doors are closed"}` while the event is not open (the visit keeps its hit) · 409 `{error: "this session has not started — send a pose first"}` for a parked assignment · 404 `{error: "no king"}` · 409 `{error: "fallen", king}` · 409 `{error: "already hit", king}` — this visit already hit · 409 `{error: "not near", reach}` unless `kingReach` with `KING_HIT_SLACK` on the session's **last pose** is `"ok"` (`reach` = the verdict; the game flushes a pose first) · 200 `{ok, king}`. On a hit: a journaled `set` of the `health` path to `hp − 1`, then `signal(signals.hit, guest, {hp, max})`, then at 0 `signal(signals.fallen, guest, {hp, max})`, all `by` the session's `device`; then a `king` frame naming the hitter. **One hit per visit**: a visit is spent from its hit until that guest's duck is found — `begin` for a guest whose visit already hit (a re-scan mid-walk, Leave and scan again, after a director's end or a timeout) carries the hit over; a find ends the visit (a re-scan in the 8 s the found session lingers starts a fresh one); a story restart forgets every visit, and so does a server restart (in memory, like sessions). The `Assignment`'s `kingHit` says a re-scan is the visit that already hit, so a game shows ⚔ spent from the start |
| `POST /api/spatial/moment` | session token (`x-loom-token`, or `token` in the body) | `{kind: "escape"}` · `{kind: "heart", prop}` · `{kind: "pickup", prop}` (wave 26) | One route for the three game moments, judged on the session's **last pose** (the game flushes a pose first), in this order: 401 / 410 as for poses · 400 `{error: "bad moment"}` (an unknown `kind`, a heart or pickup with no `prop`) · 409 `{error: "doors are closed"}` while the event is not open · 409 `{error: "this session has not started — send a pose first"}` (parked) · heart / pickup: 404 `{error: "no such prop"}` (no prop of that kind with that id). Then per kind. **escape**: 409 `{error: "not out", distance}` unless `voidDistance` ≥ `ESCAPE_M − ESCAPE_SLACK` · 409 `{error: "cooldown", retryMs}` within 20 s of this session's last · 200 `{ok, kind, lines, spawn, cooldownMs: 20000}` — the server re-seats the pose at the spawn (room, floor and presence follow; the terminals' ghost jumps back) and commits `simulation escape attempt`. **heart**: 409 `{error: "sealed"}` while the map's King stands · 409 `{error: "already"}` once this guest heard it tonight · 409 `{error: "not there"}` unless `heartReached` · 200 `{ok, kind, lines}` — commits `simulation heart reached {prop}`; the guest counts as having heard it only when `lines` is not empty (empty: he isn't awake yet, or a restart forgot; the game stays silent and asks on the next entry). **pickup**: 409 `{error: "already"}` once this guest took it · 409 `{error: "far", distance}` unless `pickupReach` with `PICKUP_SLACK_M` · 200 `{ok, kind, lines, item, prop}` — commits `simulation pickup taken {item, prop}`. Every commit is journaled `by` the session's `device`. `lines` (`[{from, text}]`, display text) are what that one commit said to this program, game-only beats included (`chat.ts` `momentLines`); they come back **only** in this answer, never on a stream, a phone, a booth or Run (`GAME_ONLY_BEATS`: *Escape Attempt*, *Heart In The Simulation*), so Trabolta can chastise before his reveal. A story that throws on the signal still answers 200 with empty `lines`. The route never answers `{error: "not found"}`: a game reads any other 404 body as an old server. Memory only, cleared by a story restart and lost on a process restart: the cooldown, who heard the heart, who took each pickup; the story's own guards (`program.sim_heart`, `carries_virus`) keep the heart and the virus once-only across one |
| `POST /api/spatial/reset` | session token | `{}` | 401 / 410 as for poses · 409 `{error: "already found"}` · 200 `{ok, spawn, duck}` (wave 59, the run reset). The session's pose goes back to its spawn and Gerald is dealt a new spot, never the one he was in, from a seed of its own for each reset; a `duck` frame goes out at once and the jump on the next flush. No clock, level, hit, disk or score moves, and it commits nothing, so it is open while the doors are closed. A game ignores an old server's 404 and walks on with Gerald where he was. |
| `POST /api/spatial/ready` | session token | `{}` | 401 / 410 as for poses · 200 `{ok}` (wave 33). The game's intro (the video, the tutorial) is over: the session's duck-run clock restarts now, **once** (a second call only refreshes the pose timeout), so a first-timer's run isn't timed through the intro. Commits nothing, so it is open while the doors are closed. An old server's 404 is ignored. |
| `POST /api/spatial/prefs` | session token | `{turn: "snap" \| "smooth"}` | 401 / 410 as for poses · 400 `{error}` for no known key or a bad value · 200 `{ok, prefs}` (wave 33): the program's game settings, merged over what it had, dealt back on **every later assignment** (`prefs`) whatever the device. Kept in the state dir (`spatial-prefs.json`, guest → settings), across a restart **and** a story reset (they are the person's comfort, not the story's). Commits nothing. Since wave 33b no client posts it (VR's snap turn is gone, so there is no setting to keep); it stays for the additive-server rule and an older APK |
| `POST /api/spatial/told` | session token | `{talker, mark}`, strings of 1–64 characters (wave 49) | 401 / 410 as for poses · 400 `{error}` · 200 `{ok}`. Remembers what this program told a talker (`told[guest][talker] = mark`, the latest wins), dealt back on every later assignment. Memory only: never journaled, forgotten by a story reset and a process restart. Commits nothing, so it is open while the doors are closed |
| `GET /api/spatial/descent` | as `GET /api/spatial/house`: a session token, a mod token or an author session | — | 401 · `{script: DescentScript \| null}` (wave 49): the event's `descent.json`, §2.5. An old server's 404 means no words |
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
  avatar?: string | null;                    // the profile picture's avatar key (`/e/<eventId>/api/avatar/<key>`)
  kingHit?: boolean;                         // this visit already hit the King: ⚔ starts spent (missing: an old server, not yet)
  picked?: string[];                         // wave 26: pickup prop ids this program took tonight (memory; missing = none)
  heartHeard?: boolean;                      // wave 26: this program heard the in-game heart tonight (memory)
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
| `hello` | `{eventId, houseVersion, players: PlayerState[], king}` — `king` the shared `KingState` (null: the map has none; missing: an older server, no shared King) |
| `join` | `{player: PlayerState}` |
| `poses` | `{t, players: [{session, p, yaw, pitch, room, floor}]}` — every 100 ms, only players whose pose changed since the last flush |
| `found` | `{session, guest, name, duck, released, captured}` — `captured` as in the POST reply (wave 9; an older server sends none, read as never kept) |
| `leave` | `{session, reason: "ended" \| "found" \| "timeout" \| "replaced" \| "reset"}` |
| `house` | `{version}` — refetch the map |
| `duck` | `{session, duck: DuckSpot}` — sent right after a `house` frame, once per player on the stream whose duck moved (another position or room) or was re-dealt (its spot is gone). Never for a parked assignment (it reads its duck from `GET /api/spatial/house`) or a session that already found its duck (that duck stays put) |
| `reset` | `{kind}` — the story restarted; every session is over |
| `king` | `KingState & {by}` — the shared King changed: a hit (`by` = the hitter's display name), a director's edit or the story's restore (`by: null`), a map swap. Sent **only when** `id:hp/max` differs from the last one sent; the runtime calls `syncKing()` after every committed mutation, so a story `set Night.king_hp = …` reaches the games too |
| `avatar` | `{session, avatar}` — a live player's profile picture changed (their own pick on `/api/guest/picture`, a Wikipedia lookup that landed), one frame per live session of that guest |
| `lights` | `GameLights` (wave 39, `@loom/house` `lights-presence.ts`; read it with `gameLightsOf`) — what every real house light shows now, below |

**The `lights` frame** (wave 39): `{at, source: "house" | "estimate",
pulse: "breathe" | "blink" | "okay" | null, lights: GameLight[]}` with
`GameLight = {id, room, pos: {x, y, z}, kind, color: "#rrggbb", level:
0..1, effect, pulse, safety}`. `lights` is every fixture of the config in
force whose room is on the map in force, in file order (absolute house
metres, like `lights.json`); `color` is the colour at full brightness and
`level` its brightness (OFF is 0; rounded to 0.001); `pulse` is true for a
fixture a program is under (§1.4 presence) and the top-level `pulse` is
the presence effect, null when presence is off. `source` says where the
states come from: `house` is the lights module's own report (a fixture
the report lacks is estimated), `estimate` the server's replay (§1.4).
It is sent:

- to each new subscriber right after its `hello`, **only when it has
  lights** (a config with nothing placed on this map sends no frame, so a
  game draws the house as it always did);
- to every subscriber on a change (a `shown` report, a presence change, a
  story cue, a test, a config save or snapshot, a map swap, the module
  coming or going), at most once per `GAME_LIGHTS_MIN_MS` 250 ms with the
  trailing edge kept, and only when it differs from the last one sent
  (`at` aside);
- every 250 ms while the source is `estimate` and a fade, a repeat, an
  effect or a loop is running, again only when it changed (a settled house
  sends nothing); and once when a `house` report goes stale by itself.

Once a stream has had lights, a change that leaves none sends `lights:
[]`: a game treats that like no frame. No timer runs while the stream has
no subscriber, and `dispose()` stops them. Older clients ignore the frame.

`PlayerState = {session, guest, name, world, device, p, yaw, pitch, room,
floor, duck, found, startedAt, avatar}`; `room`/`floor` are computed
server-side with `locate` — always the raw room, so the terminals draw a
player where they really are. Since wave 26 each session also keeps a
**presence room** (`presenceRoom` on every pose, re-seated on an escape,
reset on a map swap; memory only, never on the stream): the voice relay
(`voicePlayers()`), a game's camera list (§2.3) and the screen state's
`spot.here` (`spotHere`: the live claimed players whose presence room is
that spot's room; 0 for a `view: "reinstall"` spot) judge by it. `avatar` is the guest's avatar key, resolved
live (`AvatarBook.keyFor`), null when they have no picture. A client's
picture URL is `${base}/api/avatar/${avatar}` with `base` = `/e/<eventId>`
(the existing public route, same origin for every sub-app; VR uses its
absolute server URL); a missing field (an older server) is the plain
capsule. A session with no pose for 60 s leaves (`timeout`); a found
session lingers 8 s (so terminals can celebrate) then leaves (`found`). A
parked assignment is not a player yet (no `join` until its first pose); one
nobody claims within 5 min is dropped. `released` (in `found` frames and
the `found` response) means the program was captured and no longer is;
`captured` true with `released` false is a **kept** find: every client
shows *GERALD CAN'T HELP*, with no egg and no fanfare (the tablet, the
headset, the terminals' window and the TV mirror).
`EventRuntime.restart()` ends every session (`reset`), `dispose()` ends the
streams. A server **process** restart (a crash, a redeploy, SIGTERM) loses
every session and parked assignment, since tokens live in memory: the
game's next call answers 401 and the program is scanned again. Found runs
survive (`spatial-runs.jsonl`). `hello` is sent on every (re)connect, so a client compares its
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
5 cm aside): then they go back to the new map's spawn. While the King is
fallen standing room is judged on `withFallenKings(house, {king})`, as the
games walk it, so a player in his doorway keeps their place. The rain variant
is the case that needs it — the shed is a room on `house.shed.json` and a
solid box prop on `house.json`, flush with the yard's fence, so a program
standing in it on a switch back to the tent would be wedged between the
box and the fence. The server re-seats its copy of the pose; the web game
(`bodyAfterRemap`) and the VR game (`respawn_after_remap`) apply the same
rule to their body when they load the new map (the locate goldens pin
`standable` for the GDScript port). Then `house {version}`, then the
`duck` frames above, then a `king` frame if the swap changed him.

### 2.3 Camera feeds (wave 14)

Every wall terminal can send a small picture of its real room; the games
show it as a live window where that terminal hangs in the virtual house
(`HouseScene.setTerminalFeed`), and the terminal's `view=shadow` draws the
players over its own camera. Since wave 26 (R5) a game shows only the
terminals of the room the player is in (the presence room, §2.2), and a
terminal nobody's room holds sends slowly (`watched`). Server: `core/server/spatial-cams.ts`
(`CamStore`, `parseCamUpload`), wired in `EventRuntime`. **Memory only**:
the latest frame per spot with its receive time — never journaled, never on
disk, a restart has no feeds until the next upload. A spot that leaves the
map (a save, a variant switch) loses its feed at the next call.

| Route | Auth | Body / query | Result |
|---|---|---|---|
| `POST /api/mod/spatial/cam` | mod token (`x-loom-token`) or author session — not a host-only booth, not a session token | `{spot, jpeg, w, h}` — `jpeg` base64 with no `data:` prefix, starting with the JPEG SOI (`FF D8`); `w`/`h` 1..4096. Read under its own 140 KB body cap (`CAM_BODY_LIMIT`) before the generic parse | 403 not a moderator · 400 bad body · 413 decoded JPEG over 96 KB (`CAM_MAX_BYTES`), or the body over the cap · 404 `{error: "no such spot"}` unless `spot` is a terminal id of the event's current map · 200 `{ok: true, at, watched}`. **Rate cap:** a frame from the same spot < 150 ms after the last kept one (`CAM_MIN_GAP_MS`) is dropped, answering 200 `{ok: true, at, dropped: true, watched}` with the kept frame's `at` — a terminal never needs to back off. `watched` (wave 26): a player's presence room is this spot's room now (`linkedSpots`). A terminal sends ~3 frames/s (333 ms) at 320×240 (160×120 before wave 33b), JPEG quality ~0.5, while watched, and one frame every 2 s while `watched: false`; an old terminal ignores the field |
| `GET /api/spatial/cams` | as `GET /api/spatial/house`: a session token, a mod token (header or `?token=`) or an author session | — | 401 · `{cams: [{spot, at, w, h}]}` — only frames newer than 15 s (`CAM_FRESH_MS`), by spot id. **A game session sees only its own room** (wave 26): the feeds whose spot's `room` is the session's presence room, never a `view: "reinstall"` spot (the tent), none for a parked session or one in no room. A moderator sees every feed |
| `GET /api/spatial/cam` | as `cams` | `?spot=<id>` | 401 · 404 `{error: "no feed"}` when there is none, it is older than 15 s, or (a game session) the spot is not in its list · 200 the JPEG bytes, `content-type: image/jpeg`, `cache-control: no-store`, `x-cam-at: <ms>` |

Clients poll a frame at ~3 fps only for the feeds they are showing, and the
list every ~2 s. The web game (`reinstall/web/src/game/cams.ts`, `CamFeeds`):
the 4 nearest terminals with a fresh feed in the player's own presence room
(never the tent's station), on their floor and within 12 m on the plan
(`pickFeeds`; none while the player is in no room), one request in flight per feed, a repeated
`x-cam-at` never decoded twice, fetch → `createImageBitmap` →
`setTerminalFeed` → `close()`; polling stops while the tab is hidden, after
a find or an end (a pause on the server does not stop it — the feeds are the
real room, which keeps moving); a feed that fails 3 times rests 5 s; a 401 /
410 on the list stops it for good. The window: a 0.48 × 0.36 m (4:3,
`FEED_W` × `FEED_H`) unlit picture in a thin Win98 bezel, proud of the
terminal's screen and facing its yaw / pitch; with no feed the terminal's own
screen look shows. Both games draw every terminal — screen, halo, window and
VR's label — at three times that size across the wall, never deeper
(wave 33b: `GAME_TERMINAL_SCALE` / `buildHouseScene({terminalScale})`, VR
`HouseBuilder.TERMINAL_SCALE`), so the window is 1.44 × 1.08 m; the
terminals' own world view and the map editor keep them at 1×.

### 2.4 Voice (wave 19; same room since wave 26)

The wall terminals' microphones are heard in the games at each terminal's
screen, and a player's headset is heard on the terminals of the room they
are in — the audio twin of §2.3. Plain HTTP, no WebRTC or WebSocket: a source **POSTs**
raw chunks up, a listener holds **one SSE stream** down, and the server does
the routing, since it already holds every pose and every terminal spot.
Server: `core/server/spatial-voice.ts` (`VoiceRelay`, `parseVoiceUpload`),
the rule in `@loom/house` `house/src/voice.ts`, wired in `EventRuntime`.
**Memory only, no ring**: a chunk is fanned out the moment it lands to the
streams that can hear it and forgotten — never journaled, never on disk; a
restart has no routes until devices reconnect. Voice ignores a pause like
poses and cams (the real room keeps moving).

**The wire.** G.711 **μ-law, mono, 16 000 Hz** (`VOICE_RATE`), one byte per
sample, **200 ms chunks** (`VOICE_CHUNK_MS`, `VOICE_CHUNK_BYTES` 3 200). Every
port encodes with `mulawByte` (14-bit magnitude `floor(|x|·8192 + 0.5)`,
clipped at 8159, biased, segmented, inverted; 0 → `0xFF`) and decodes with
Sun's `ulaw2linear` / 32768; the Godot port is pinned by
`house/test/fixtures/voice-mulaw.json`.

| Route | Auth | Body / query | Result |
|---|---|---|---|
| `POST /api/spatial/voice` | **a terminal**: a mod token (`x-loom-token`) or an author session, plus `?spot=`; **a game**: its session token, no `spot` | `?seq=<n>` a non-negative integer, increasing per source; the body raw `application/octet-stream`, `VOICE_MIN_BYTES` 160 … `VOICE_MAX_BYTES` 8 000 bytes (≤ 500 ms). Read under its own 8 000-byte cap ahead of the 2 KB `/api/spatial/*` JSON cap; no author-session lookup (it is not a `/api/mod/` path) | Who first: 401 `unknown session token` · 410 `this session is over` · 403 `moderators only` (a non-mod token with a `spot`) · 400 a mod token with no `spot`. Then the chunk: 400 a bad `seq` / `spot` / body size · 413 the body over the cap (the router). Then the spot: 404 `no such spot` (not on the current map) · 403 `voice is off at this terminal`. Else 200 `{ok: true, listening, ears}` — `listening`: someone can hear this source now; `ears`: how many listener streams do; `{ok: true, listening, ears, dropped: true}` when the chunk went nowhere (nobody hears it, a parked session that has not posed yet, or a stale seq). A client treats `listening: false` as "empty the queue" only: the stream's `listen` is the authority (an answer can land after a newer `listen {on}`) |
| `GET /api/spatial/voice/stream` (SSE) | as the upload, the token in `?token=` (EventSource sets no headers): a terminal = a moderator + `?spot=`, a game = its session token | `?mic=0\|1` — this device's room can be heard (absent = 1; a terminal sends 0 while its mic is refused, missing, off or its page's audio is locked); `?hear=0\|1` — it plays what it hears (absent = 1; 0 under the TV mute, ⚙ voices off, or locked). A device re-opens its stream when either changes | the same refusals as plain HTTP before the stream opens (a parked session's stream opens; it hears nothing until it joins) · 200 `text/event-stream`. The path ends in `/stream`, so Caddy neither compresses nor buffers it. A token-bearing open skips the author-session lookup like the camera polls; the editor may open one on its cookie (`wantsModRead`) |

**Frames** (`event:` name, JSON `data:`; `VoiceFrames`):

- `hello {codec: "mulaw", rate: 16000, chunkMs: 200, as: "terminal" | "player", spot? | session?, listen, ears}` — first, once.
- `listen {on, ears}` — whether this device's own mic is wanted (someone can hear it), and by how many listener streams (the web game's HUD says *🎤 N terminals can hear you* off it); sent on a change of either. **A source uploads only while `on`**, so a terminal's mic never streams to an empty room.
- `voice {from, kind: "terminal" | "player", spot? | session?, name?, gain, seq, data}` — `from` = `t:<spot>` / `s:<session id>`; `name` the spot's name on the map or the program's; `gain` 0..1 (always 1 since wave 26; the field stays on the wire); `data` base64 μ-law. A stream more than 64 KB behind (`VOICE_LAG_BYTES`, ≈ 3 s of one source) skips `voice` frames until it catches up: late voice is worse than a gap. Control frames always go.
- `bye {from}` — a source this stream heard (it delivered at least one chunk since the route formed) is out of earshot: fade it out and drop its buffer. A source that merely goes quiet sends nothing; its buffer drains.
- `:ping` every 15 s (`VOICE_PING_MS`). The stream's stall cap is the same 64 KB: past it only the control frames and the ping are written, so a reader that stopped (a suspended tablet with its socket up, a half-open socket after a Wi-Fi flap) is dropped by the ping 15 s on and leaves the routing. **The newest stream wins**: a player's older stream for the same session is closed, and a spot keeps at most `VOICE_STREAMS_PER_SPOT` 2 (the oldest closed). The stream closes when its session ends (the next call answers 410), on a story reset or restart (every session ends; terminals reconnect), and in `dispose()`.

**Who hears whom** (`@loom/house`; the server's `VoiceRelay.route()` applies
it on every 100 ms spatial flush — a move, a map swap, a session that ended —
and on every listener connect / disconnect; the spatial loop keeps running
while any voice stream is open):

- `voiceOn(house, spot)`: `voice: true` → on, `voice: false` → off; unset →
  off for a terminal standing in the map's spawn room (the tent laptop is the
  web game, beside the headsets; the shed on the rain map), on anywhere else.
  Both show maps also set `"voice": false` on `tent`. The server refuses an
  off spot's uploads and streams and never routes to it.
- **Same room only** (wave 26, R5). A player hears terminal T
  (`hearsTerminals`) when T's voice is on, T is not a `view: "reinstall"`
  terminal (the tent is never linked, even with `voice: true`), and T's
  `room` is the player's room; the `VOICE_MAX_TERMINALS` 4 nearest in plan.
  A terminal hears player P (`hearsPlayers`) under the same rule; the
  `VOICE_MAX_PLAYERS` 3 nearest its `pos`. A player in no room (the void)
  hears none. Nothing is heard through a wall or across a doorway, and there
  is no reach: the old 12 m / 8 m reaches, the edge fade and `keep` are gone.
  `gain` is always 1. Nearest first; ties by id.
- **The player's room is the presence room** (`SpatialHub.voicePlayers()`
  passes `room: s.presence`, §2.2), so its doorway hysteresis (0.75 m from
  the door gap, or over a joining stair) keeps a player standing in a door
  from flapping the route (`bye`, a fade, a restart, the uplink toggling).
  A caller that passes no `room` gets `locate`'s, with no hysteresis.
- The relay passes `only` (the rule's `VoiceRouteOptions`): a player's
  candidates are the terminals with an open stream whose mic can be heard
  (`mic` not 0), a terminal's the players not every one of whose streams
  says `mic=0`; a stream with `hear=0` is routed nothing (it is still told
  `listen`).
- A terminal hears only players and a player only terminals: nothing hears
  itself, and two headsets never hear each other (not asked for).
- `seq`: a chunk at or below the source's last kept seq is dropped — unless
  the source has been quiet for `VOICE_FRESH_MS` 1.5 s, when a lower seq is
  a reloaded device counting from 0 again and is kept.

**Clients** (each its own lane; the rules every one follows): an open mic
behind a **voice gate** (`VoiceGate`: a chunk whose RMS is over
`VOICE_GATE_DBFS` −42 dBFS opens it, with one chunk of pre-roll and a
`VOICE_HANG_MS` 400 ms hang), and **half-duplex in software**, which is
different on each end:

- **A terminal holds** (`holdUntil`): it sends nothing while it plays
  incoming voice, speaks, or plays its own sounds, plus `VOICE_TAIL_MS`
  300 ms — and the chunk's span, the capture buffer and the device's output
  latency, since a chunk is judged when its capture buffer ends. Its speaker
  sits beside its mic; this hold is what breaks any loop.
- **A game barges in** (D5b, `raiseUntil`): while a terminal's voice plays
  there (+ the tail) its gate rises to `VOICE_BARGE_DBFS` −28 dBFS instead
  of closing, and keeps no pre-roll. The echo of the room stays home; a
  player speaking up is sent at once. Their voice then plays on the terminal,
  whose hold pauses its room — **the floor goes to the player when they
  speak**. A hard hold on both ends was one-way: a source over the gate
  without a pause (a loud party room) held the floor for good, and a headset
  player was never heard. An incoming voice under `VOICE_BARGE_MIN_GAIN` 0.2
  raises nothing (with every gain 1 since wave 26, none is that faint).
- **A game's own sound holds** (wave 26): while the game plays something
  of its own — Trabolta's in-game lines, the jump scare, and in VR every
  sound effect — its mic sends nothing for that long + `VOICE_TAIL_MS`
  (web `VoiceLink.holdFor`, VR `VoiceLink.hold_for`, both on the gate's
  `holdUntil`), so the terminals never hear the game back.

Playback keeps a small jitter buffer per source (`jitterPlan`:
`VOICE_JITTER_TARGET_MS` 200, the terminals 250; past `VOICE_JITTER_MAX_MS`
400 ms queued it skips ahead, cutting only what is queued past the target,
with a short fade), fading in on a start and out on `bye`. A player's own
stream drops what it heard on a (re)connect's `hello` and takes a lower seq
again after `VOICE_FRESH_MS` of quiet, like the server.

- **Terminals** (`terminal/src/voice/`): auto / world / shadow / face / chess /
  casino have mic + speaker; `tv` a speaker (cut by the TV mute) and a mic
  off by default; `mirror`, the setup screen and an unplaced terminal
  neither. ⚙ / URL `mic=0|1` and `voices=0|1`. The heartbeat reports
  `mic=live|muted|denied|insecure|locked|off` on `/api/screen/state` (beside
  `fs=`; `muted` = ⚙ turned it off, `locked` = open but the page's sound
  waits for a touch), and Run → Terminals shows it as 🎤 (red for `denied`,
  plain http or `locked` on a terminal that should hear). Echo cancellation,
  noise suppression and AGC are asked off (the gate is in software; on
  Android they switch the device into its voice-call audio mode). The map is
  read before the link opens (retried, re-read every minute: a director
  turning a spot's link on or off takes effect without a reload).
- **The web game** (`reinstall/web/src/game/voice.ts`): off by default (it
  runs on the tent laptop; config `voice`, URL `voice=1|0`); on, it hears the
  terminals through `PannerNode`s at their screens. The mic is low-passed at
  7 kHz before the resample; a track the OS ends reads NO MIC.
- **VR** (`reinstall/vr/net/voice_link.gd` + `voice_codec.gd`): the mic on
  **B / Y** (desktop **M**), `AudioStreamPlayer3D`s under each terminal; one
  keep-alive `HTTPClient` for the uploads. The mic reads MIC STARTING… until
  a real (non-zero) sample lands — a missing input mixes zeros, which count
  as no frames (then NO MIC); a refused grant is its own state (`denied`).
  The Quest's microphone grant is asked in the lobby, before any session,
  and the lobby's ASK AGAIN asks once more (§5).

The mic needs a secure context in a browser (https, or localhost): a LAN
`http://<ip>:7000` setup gets no microphone on the tablets (`mic=insecure`),
as with the camera. No `Permissions-Policy` header is sent, so top-level
pages may ask; nothing works inside a frame (`x-frame-options: DENY`).

### 2.5 The descent and the footsteps (wave 49)

Contract: [`loom-w49-contract.md`](./loom-w49-contract.md) C1–C3. The rules
are `@loom/house` `descent.ts` and `footsteps.ts`; the server deals, stores
and streams. Nothing here reaches the journal, and no story changes.

**The level.** Every `Assignment` carries `descent` and `told` (an old server:
neither, and a game reads `reinstalled`). `descent` is
`SpatialHub.descentFor(guest)` at the **deal**: a director's forced level, else
`descentLevel(reinstalled)`, so the first walk is 0. It is fixed on the session:
a later force, a resume, a station's poll or the walk's own find never move it.
`told` is read live (talker id → the mark), so a resume carries it.

**The words.** `descent.json` is read live like `credits.json`
(`server/descent.ts` over `live-file.ts`): the project's file, else
`LOOM_DESCENT`, else, with no project, the scenario's own. Cached 5 s; a file
that fails `validateDescent` reads as none and is logged once (the first source
with a file is the one in force, usable or not). `sync-show` / `sync-example`
always replace the project's copy and refuse an unusable one; no reload is
needed for it to show. `loomcheck` lints it.

**The footsteps.** `SpatialHub` measures each session's speed from its poses over
at least `FOOTSTEP_MEASURE_MS` (memory only). A game sends no pose while its
player stands still, so a pose unchanged for `WALK_STILL_MS` (500 ms) reads as
standing; an escape's teleport or a re-seat restarts the measure. On every flush
it runs `walkersOf` over joined, unfound, un-held sessions (room = the presence
room) and tells the runtime when `sameWalkers` is false, at most every
`FOOTSTEPS_MIN_MS` (the trailing edge kept), at once for the last stop. The hub
never imports `AudioHub`.

| Route | Auth | Body / query | Result |
|---|---|---|---|
| `GET /api/mod/audio/walkers` | mod token (`x-loom-token` or `?token=`) or an author session, never a host | — | 403 `moderators only` · 403 `not from a booth` · 200 `text/event-stream`: `:ok`, then `walkers` events, each a `WalkersFrame {seq, at, walkers: Walker[]}`: one on connect, one on every change, one every `FOOTSTEPS_KEEP_MS` while anyone walks; `:ping` every 25 s. Every pushed frame takes a new `seq`. Sent `cache-control: no-cache, no-transform`, and `deploy/Caddyfile` exempts the path from its compression |
| `POST /api/mod/audio/walkers/test` | mod, never a host | `{speaker}` | 400 no speaker · 404 `no such speaker` · 200 `{ok}`: a walker on that speaker alone at 0 dB, 1.4 m/s, for `FOOTSTEP_TEST_MS`, merged into the frames as id `test`. Memory only |

## 3. The web game — `reinstall/web/` (`loom-reinstall`)

React shell + three.js canvas (three r186 needs WebGL2: the wizard probes
for it once and, without it, disables **Play here** with the reason rather
than begin a session it can't draw). Screens: **setup** (moderator passcode,
device name, role) → **scan** (camera via the terminal's `Scanner`, typed
name fallback via `candidates`) → for a scanned program, **Play here** or
**Send to <station>** (online VR stations listed) → **play** → **found**
(the duck lays a golden egg and flies; "Reinstallation complete" or, for a
program that wasn't corrupted, "You found Gerald"; for a kept find —
`released` false, `captured` true, else the captured state the walk began
with — "GERALD CAN'T HELP": *Gerald can't help <name> tonight. The
Internet keeps you — your phone says what happens next.*, progress
*Nothing to copy*, no egg, decided by `findOutcome` in `game/hud.ts`) →
back to scan. A marked, not-captured program reads *Marked program
detected* / *STATUS: MARKED — marked for reinstallation*, and the scan
screen lists them under *Marked for reinstallation*; one a director
restricted without a mark reads *Program held* / *STATUS: RESTRICTED —
held, not marked* (it never says who holds it). An unmarked
program (`eligible` false; a pre-wave-16 server's row: neither captured
nor restricted) is never a quick pick; scanned or typed, its card reads
*Program not marked* / *STATUS: healthy — not marked for reinstallation*
with *Not marked for reinstallation.* (`NOT_MARKED`; it states no rule,
wave 26 G2), and Play here and every headset button are
disabled. The
server's 409 for one (a race) reads the same line (`beginErrorText` in
`program.ts`).
Provisioning link: `/reinstall/?code=<mod>&name=Spare tablet` (a spare
tablet or a headset-only controller since wave 18b: the tent laptop is a
terminal, below). The scan
step's **⚙ Setup…** and **🗺 House map** open only after a 2 s hold
(`kiosk.ts`, a copy of the terminal's `useLongPress`; W-15): the tablet
is in guests' hands.

**The intro** (wave 33). Every assignment (`begin`, a station poll)
carries `reinstalled` — the ducks this program found since the story
(re)started, counted off the run log, so it survives a process restart
and a story reset starts it again — and `prefs` (§2.1); the candidates
carry `reinstalled` too. After the **Play here** tap and before the begin,
the flow plays the Reinstallation Process video full screen
(`IntroVideo.tsx`, `/reinstall/intro/reinstallation.mp4`, H.264 720p,
served by byte range): no session is live, so nothing is timed or timed
out. It is skippable (**Skip video ▶**) only when `reinstalled ≥ 1`
(`introSkippable`). It never blocks the game: a video that fails to load
goes straight on, one that makes no progress for 15 s offers
**Continue ▶**, a refused autoplay (the tent laptop's `auto` start, no
tap) plays muted with **🔊 Turn the sound on**, and a held flow pauses it.
The walk then opens with the **training** (`game/tutorial.ts`, pure): a
mouse gets *Take the mouse* (a click on the view, pointer lock) → *Look
around* (120°) → *Walk* (3 m) → *Run* (1.2 s with Shift) → *You're ready*
(5 s); a touch screen gets the LOOK stick, the MOVE stick and the goal.
Each step finishes by doing it; **Skip training ▶** only at
`reinstalled ≥ 1`. Its end posts `ready` (§2.1) and restarts the game's
own clock, the path reveal's minute included. A mouse looks like a
first-person game's (0.12°/px under pointer lock; Esc gives it back; the
celebration, a hold and the end release it); a browser that refuses the
lock (`pointerlockerror`) drags to look, as before, and the drag passes
the click step. `?intro=0` turns the intro off on a device (the config's
`intro`). The copy was signed off on 2026-10-28.

The two videos are encoded from the source recording (an iPhone HEVC
10-bit HLG `.MOV`): bt2020 → bt709 SDR, 1280×720, stereo. Re-encode both
if it changes (`SRC` = the source file):

```bash
VF="scale=1280:720:flags=lanczos,format=yuv420p10le,colorspace=all=bt709:iall=bt2020:itrc=bt2020-10:format=yuv420p"
# The recording is quiet (−39 LUFS): compress it, then bring it to −14 LUFS
# (−1.5 dBTP). For an exact level run loudnorm twice: once with
# print_format=json, then with its measured_* values and linear=true.
AF="highpass=f=60,acompressor=threshold=-36dB:ratio=4:attack=10:release=250:makeup=12dB:knee=6,loudnorm=I=-14:TP=-1.5:LRA=7"
ffmpeg -i "$SRC" -map 0:a:0 -af "$AF" -ar 48000 -ac 2 loud.wav
ffmpeg -i "$SRC" -i loud.wav -map 0:v:0 -map 1:a:0 -vf "$VF" -c:v libx264 -profile:v high -level 4.0 -preset slow -crf 27 \
  -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -b:a 128k -ac 2 \
  -movflags +faststart reinstall/web/public/intro/reinstallation.mp4
# The Ogg's audio comes from the WAV too: filtering inside the Ogg mux
# leaves non-monotonic audio timestamps.
ffmpeg -i "$SRC" -i loud.wav -map 0:v:0 -map 1:a:0 -vf "$VF" -r 30 -c:v libtheora -b:v 1400k -c:a libvorbis -q:a 4 \
  -ac 2 -ar 44100 -shortest reinstall/vr/media/reinstallation.ogv
```

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
after resume. Each held retry touches the idle leash (`heldFind`), so a
long pause at Gerald never times the session out. Poses at 10 Hz, latest-only (never queue).

**The path reveal** (wave 26, R2; `hud.ts` `pathShown`). For the first
`PATH_REVEAL_MS` (60 s) of each session the game hides the way to Gerald:
no chevron trail, no compass pip, no distance, no warmer / colder. The
heat box reads just *FIND GERALD*. Then *The way to Gerald lights up.* and
the trail draws at once. The minute is per session and client side, so a
re-scan starts it again. Gerald's quack is no path hint and is never
delayed. A duck moved before the reveal says just *Gerald moved.*

**The outside** (wave 26, R4). The walker may leave through an exterior
door (the mud room's) onto the outside ground (`outsideGround`, drawn as a
dark plane with a faint grid, the rooms cut out; `physics.ts` `groundAt`).
Walls and fences still block: the only way out is a door gap. What waits
out there is the void (*The moments*, below).

Session lifecycle:

- A session with no input for 120 s ends itself (a countdown for the last
  20 s).
- While the tab is **hidden**, rendering, the pose keepalives and the
  idle countdown all pause — the server drops a tab hidden for 60 s
  (`timeout`) instead of every terminal showing a frozen ghost; coming
  back resumes the countdown where it was (and a session that timed out
  meanwhile learns it from the 410).
- **The stream reopens.** The tablet's and the map page's spatial
  stream reopen after a refusal (a Caddy 502 while loom restarts) on a
  1 s → 15 s backoff, unless a check of the same token says it is
  revoked or the event is gone (401 / 403 / 404).
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
- **Only the marked may play** (wave 16, re-checked wave 18b — R16). Every
  way in is `POST /api/mod/spatial/begin`, which refuses an ineligible
  program with 409 `not marked for reinstallation`; no device sends
  `force`. The hub re-checks too (`mayPlay`): a walk parked for a headset
  whose program was unmarked before the put-on is never handed out (or a
  claiming pose answers 410), and a live walk whose program was unmarked
  mid-way ends with `leave {reason: "unmarked"}` — the web game and the
  headset both say *No longer marked for reinstallation — the simulation
  ended.* A found walk is exempt (its own release unmarks it).
- **Held** (wave 18b, `Game.hold` / `Play` `held`): a host that covers the
  game (the tent laptop under a story overlay) holds it: the controls, the
  leash, Gerald's quacks and a find pause, the pose pump keeps its
  keepalives, so the server never times the session out; letting go
  carries on.

### The tent laptop — one device, terminal + wizard (wave 18b)

The laptop in the tent runs the **wall terminal** at `view=reinstall`
(`terminal/src/reinstall/`, a lazy chunk), not this app's page. The
terminal mounts this app's own flow (`flow.tsx`: the choose card, the
begin, the game) from source through the `@loom/reinstall` alias, in a
**shadow root** with its own React root (`pane.tsx`) and this stylesheet
re-scoped (`scope-css.ts`: `:root` → `:host`, `html, body, #root` / `body`
→ `.ri-root`; an iframe is refused by `frame-ancestors 'none'`). Between
walks it is a scan kiosk (wave 26, T3; `ReinstallTerminal.tsx`): a centred
Reinstallation Wizard card with the live camera, the typed field and the
quick picks as 48 px buttons, over the idle show as a quiet, dimmed
backdrop that never lands a window on the card. It takes no story slide,
countdown corner or Y2K clock; its overlays, beat cutscenes and the
glitch still play. It draws no world (the card's status bar only counts
who is reinstalling; the walkers are the TV's and the walls' to show),
sends no camera feed and has no voice link. The station's screens
(`session.ts`, pure): **idle** (the quick picks are only the programs in
the Internet — never the marked, whose names are the Antivirus' list —
and a `tablet_*` cue is a status line in the card, *Setup is preparing to
reinstall a program*, naming nobody, never a modal over the scanner) →
**checking** (the candidates) → **refused** (healthy or director-held: the
NOT MARKED card, nothing reaches the story) | **confirm** (already walking
on a headset: play here instead?) | **flow** (`start: "auto"`: straight to
Play here with no headset online, else the choose card). The flow is
**busy** (the screen layer then treats the terminal as piloting: slides
and beat cutscenes stand aside) and **held** under an overlay
(`held = takeover`), never ended by one. Its config is role `both` with
the terminal's name (the journal's `by`) and camera; the game's sounds
ride the terminal's master bus (`createSfx(soundOutput)`, built once). The
tent spot's map entry carries `view: "reinstall"` (both variants), so
`/terminal/?code=<mod>&spot=tent` provisions it.

### The King

**One King, one health bar, for every guest all night** (wave 11; before
it the fight and the chess were per session, on the tablet). A `king`
prop stands in the server-room doorway of the show's map
(`cold-lock-king`, `hp: 15`, `health: "Night.king_hp"`, `armed: {path:
"Night.king_armed", min: 1}`; the door `server-door` names him as its
`guard`). The server holds his state (§2): the story seeds
`Night.king_hp = 15` at Power On and never decrements it; only a
validated hit, a director's edit (`POST /api/mod/spatial/king`) or the
story's 👑 restore moves it. The game reads `KingState` off `hello`, the
session-token map fetch and `king` frames; with none (an older server)
he just stands, with no bar and no ⚔. The chess he plays is not here: it
is the **Server Door** terminal's (§4), at the strength his bar sets.

- **The door.** While he stands, the guarded door's gap (`doorGap`) is a
  wall for the walker and the trail never passes it (`physics.ts`
  `closedDoors`; the scene's closed leaf, `HouseScene.doors`). While he
  is fallen, for everyone, the leaf is hidden, the physics world is
  rebuilt without him and the door, and the trail routes over
  `withFallenKings` (`trailMap`).
- **The hit** (`game/fight.ts`, pure; the engine's `hitKing`): **⚔** on
  the HUD or Space. The game pre-checks `kingReach` on its own body and
  nudges (*Get closer to the King.* / *Face him.*); when it is `"ok"`
  it flushes the pose pump and posts `POST /api/spatial/king/hit`. 200:
  a thud, *⚔ You hit the King!*, the bar from the answer. 409 `already
  hit`: *You hit him this reinstallation. Find Gerald before you hit him
  again.* (`HIT_USED`, a passing notice, said again on any later try in
  the visit, which ends at the duck, not at Leave, a director's end or a
  pose timeout). An assignment with `kingHit` starts the visit spent
  (`hitSpentAtStart`), so a re-scan before the duck never offers ⚔. 409 `not near`: a buzz and
  *Get closer to the King and face him.* 409 `doors are closed`: the
  paused notice. 404: no King. 410: the session is over.
- **The HUD** (wave 26, R3): no King bar, meter or stage line. The bar
  over his head (`createKing` in `@loom/house/three`) is his only display;
  up close it eases down towards his crown (`kingBarY`: its centre at most
  `BAR_MAX_ELEV_DEG` = 16° over the camera's eye) so it stays in frame in
  hit reach. While he stands and is in view (`kingInView`: his floor,
  within 4.5 m, within 40° of the facing) the screen hides the compass and
  the heat line, which sit where his bar projects. The ⚔ HIT button shows
  while near and standing (disabled once spent, `HIT_USED` its tooltip); the help card offers
  *Space hits the King* / *⚔ by the King* only while he stands
  (`kingStands`).
- **Everyone's hits.** A `king` frame with fewer points staggers him
  (`King.hit`) and, when `by` is another player, says *X hit the King.*
  Reaching 0 plays the fanfare and *The King kneels. His door stands
  open.*; coming back says *The King stands again.*
- **A restore never shuts a player in.** When he stands again the door
  stays open for this player while `keepDoorOpen(house, king, feet)`:
  they are in a room behind a door he guards, in the doorway (within
  `RADIUS` + 0.15 m of its gap), or inside his box grown by that much. It
  shuts once they are clear. A remap while he is fallen re-seats on
  `withFallenKings` too (`bodyAfterRemap`), as the server does.
- **Nothing posts a chess result.** The tablet has no board, no ♟
  CHALLENGE, no C key and no hint; `chess won / lost / drawn` come only
  from the door terminal and the ♟ fallbacks (§6).

### The moments (wave 26)

Three things in the game post `POST /api/spatial/moment` (§2.1). The
decisions are pure (`game/moments.ts`); the engine flushes the pose pump
before each post. Answers are read by their `error` string.

- **The void** (R4). Once the player is `ESCAPE_M` (5 m) past the walls on
  the outside ground (`escapeDue`), every time and even before Trabolta's
  reveal: input stops, the jump scare plays (`Scare.tsx`: his angry face
  over a *FATAL EXCEPTION 0E* panel, the screech `Sfx.scare`; one hard
  flash, then nothing faster than 3 Hz, and no zoom or shake under
  `prefers-reduced-motion`), the escape goes up, and after `SCARE_MS`
  (1.6 s; at most `SCARE_WAIT_MS` 4 s for the answer) the player is back
  at the spawn — the answer's, else the map's. The teleport happens
  **whatever the server says**: a 409 (closed doors, not out, cooldown,
  parked), an old server's 404 or no answer just mean no penalty and no
  lines. A charged escape costs the program 5 trust and comes back with
  Trabolta's lines (§6). Only a 401 / 410 ends the game instead.
- **The heart** (R6). Trabolta's heart (`createHeart`) shows in the
  server room once the King has fallen (a map with a King but no King
  state, an old server, keeps it sealed). Reaching it (`heartReached`)
  posts once per entry. Lines: they play, and never again tonight
  (`already`, or `Assignment.heartHeard` on a re-scan). An empty answer
  (he isn't awake yet), `sealed` or `not there` waits for the next entry;
  closed doors retry on the found backoff while inside.
- **The virus disk** (R7). The floppy (`createPickup`) floats in the Hard
  Drive all night. Any program within `pickupReach` of a disk it hasn't
  taken (`Assignment.picked`) posts a pickup. Taken: the disk hides for
  good, a blip (`Sfx.pickup`), *💾 You picked up a disk.* and the answer's
  lines. `already` hides it quietly; `far` and closed doors retry on the
  found backoff; an old server, `no such prop` or `bad moment` leave it be.
  What the disk means is the story's: it unlocks the same codex entry the
  tent's printed QR gives (§6). The terminals and the map editor's 3D
  preview never draw it.
- **Captions and speech** (`game/lines.ts`, `LinePlayer`). A moment's
  lines are captioned one at a time in a Win98 window titled *Message*,
  with no speaker's name (he may not be introduced yet), above the sticks
  on a touch screen. Each holds for its reading time (`readingMs`), with
  `IN_GAME_LINE_GAP_MS` (= the terminal's `LINE_GAP_MS`, 700 ms) between
  lines, and is spoken by the terminal's device voice ladder
  (`@loom/terminal/speech/engine.ts`, sharing the page's voice floor, so
  on the tent laptop the game never talks over the terminal). The voice
  says `pronounce` of the line (the terminal's lexicon); the caption shows
  the display text. A voice is cut 12 s after it starts
  (`LINE_SPEAK_CAP_MS`), or before it starts if it has not got the voice
  floor in 8 s (`LINE_START_WAIT_MS`), so it never outlasts its caption.
  While a line plays the game's mic is held (§2.4).

The **map** page (`/reinstall/map`, and in the editor as Run → House → 🗺 Map, `map/embed.tsx`): the house plan (SVG, one floor at a
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
- **Props** (`map/props.ts`): the palette includes, since wave 26, **♥
  Heart** (a 0.6 × 1.7 × 0.6 dark rack) and **💾 Pickup** (`item` default
  `virus`). The inspector edits a pickup's `item` and either kind's story
  signal (`signals.reached` / `signals.taken`; blank = the default) and
  never offers them a label; a kind change drops what the new kind can't
  carry.
- **Checks**, live: `validateHouse`'s problems (each read back to the
  thing it names, a click selects it), plus two warnings that never block
  a save — **walkability** (`route()` from the spawn to every duck spot,
  the VR autopilot's algorithm; and every room no door / stair chain from
  the spawn's room reaches) and the story's LOCATIONs (from the mod
  view, `GET /api/state`): a room naming none, a LOCATION no room is;
  the server's `warnings` on a save add `guardWarnings` (a king too far
  from the door he guards).

### The real house lights and the graphics (wave 39)

Contract: `docs/loom-w39-contract.md` C4. The stream's `lights` frame
(`GameLights`, §2.2) is read by `spatial.ts` (`LIGHTS_FRAME`,
`decodeLights` → `gameLightsOf`; `onLights` on `openSpatialStream`) and
never enters the player table: a stream without one (an older server) and
a malformed one change nothing.

- **The bulbs** (`game/lamps.ts`, pure half `game/house-lights.ts`): every
  fixture is a small emissive sphere + an additive glow sprite at its
  `pos`, in its colour × level (over 1 in linear light, so it blooms). A
  fixture with `pulse` (a program under it) or a firmware breathe / blink /
  okay breathes with `pulseFactor` (`lampLevel`, the phase kept per fixture
  across frames); a level-0 bulb stays dark, pulse or not, as in the house.
- **The point lights**: a fixed pool per tier (2 / 4 / 8), handed every
  500 ms to the nearest lit fixtures, the player's floor first
  (`pickLamps`; a light keeps its fixture while it stays picked), the rest
  at intensity 0. The pool's size changes only with the tier (three
  recompiles the materials then; the frame time is ignored over 250 ms).
  `LAMP_CANDELA` 18 at level 1, range 7 m, decay 2.
- **The ambient**: with a frame, the house scene's own `house:hemi` and
  `house:sun` ease (1.2 s) to `ambientFactor`: 0.5 (`NIGHT_FLOOR`, the real
  house dark) to 0.65 (every fixture full) of their built intensity.
  Without one, the house looks as it did before wave 39. The terminals'
  world view and the map preview are untouched (`buildHouseScene` as is).
- **Quality** (`game/quality.ts`, pure): `low` (pixel ratio ≤ 1, 0.75 under
  pressure; 2 lights; no post-processing: the renderer's ACES tone map),
  `medium` (≤ 1; 4 lights; bloom at half resolution; vignette + grain),
  `high` (≤ 1.5; 8 lights; full bloom; + a faint chromatic edge; 4× MSAA on
  the post target). The canvas has no MSAA. `auto` (the default) starts at
  `medium` (`low` on a coarse pointer); down a step when the median frame
  interval of a 2 s window is over 24 ms, up after 10 s with every
  window's median under 17.5 ms (holding 60 fps: an interval can't beat the
  display's, so the contract's 13 ms only fires on a 90 Hz+ screen), at
  most one change per 5 s, and each time a level was left for being slow,
  going back up to it waits 3× longer. The **cap** is the device's
  `?quality=low|medium|high` (`config.ts`, kept in its config and on the
  URL; the tent terminal's flow reads it off the terminal's URL,
  `qualityHint`): the ⚙ setting (Auto / Low / Medium / High, remembered in
  `localStorage` `loom.reinstall.quality`) picks under it, `auto` adapts
  under it. On the tent's 2014 MacBook use `…&quality=medium` if `high`
  ever stutters.
- **Post-processing** (`game/post.ts`, a lazy chunk: `low` never loads
  it): `EffectComposer` into a half-float target (8-bit without a
  float colour buffer, then no bloom), `UnrealBloomPass` (threshold 0.82),
  then one grade pass to the screen (three's ACES curve at the same
  exposure, sRGB, vignette, grain, chromatic edge). Exposure 1.3 on every
  tier.
- Dev only: `?lightsDemo=1` on the Vite dev server feeds a synthetic
  frame (`demoLights`: a light per indoor room, the one you stand under
  pulsing).

### The descent (wave 49)

Contract: `docs/loom-w49-contract.md` C2 + C5; the rules both games share
(the level, the seeded plan, who wakes, how a talk walks) are `@loom/house`
`descent.ts`, the words `descent.json`, served live by `GET
/api/spatial/descent`. The more often a program has been reinstalled, the
less the simulation holds together. A first walk is level 0 and builds none
of this: no director, no visions, no Hallway, no per-frame cost but a check.

- **`game/descent.ts`** (pure): `Director` runs the walk's clock (from the
  end of the intro, on `dt`, so a hidden tab stops it) over `descentPlan` +
  `dueBeat`. A beat waits while an escape is under way, a talk is open, the
  walk is held, a vision is running, the King is within `KING_HOLD_M` or the
  player is in the Hallway; one `DESCENT_LATE_S` overdue is dropped. A vision
  that can't be drawn is skipped and the rest keep their time. Every effect
  goes through `DirectorHost`, so a whole walk is a node test. `gradeOf`,
  `flickerAt` (at most 3 Hz), `aliceAt` and `FollowerSteps` are how a vision
  moves, as numbers.
- **The words.** `fetchDescent` at the start of a walk, never blocking it; a
  failure (an old server, no file, a file that doesn't validate) is visions
  with no words and nobody awake. `?descent=N` overrides the level on this
  device; `Assignment.reinstalled` still drives the intro's skip and `visit`.
- **`game/visions.ts`** draws them, built once at walk start and only shown
  and hidden after that (`renderer.compile` at the start, so the first vision
  doesn't hitch). The steady `descentLook` and `flicker`, `tint` and `dark` are
  the fog's uniforms, the ambient (`HouseLamps.setGrade`), the neon
  (`HouseScene.tuneNeon`) and the exposure (`Post.setExposure`): the same on
  every tier, no recompile and **no new point lights**. `whiteduck` is a
  `createDuck` re-dressed (never the real duck, never findable), `self` a
  `createAvatar` going along `sampleTrail` of the route (once the trail
  shows; before that, the way they are looking), `grin` three sprites, the
  cat going first and the grin last. `dark` is the fog at about 3 m and two
  eyes behind the player, for those who turn round. `small` / `big` scale the
  eye height alone (`aliceAt`, capped under a ceiling): poses, physics and
  reach stay real, and the voice link keeps listening from the real eye.
- **Talking.** Each awake prop (`wakeTalkers`) has a face on `faceAnchor`,
  drawn within `FACE_NEAR_M`, on whichever of its sides faces the player
  (`faceSides`: it blinks and is there). `TALK_NEAR_M` opens a talk. The lines
  are their own `LinePlayer` + device voice (never the story's: `Director.hush`
  cuts them for any moment's lines), in `Talk.tsx`'s window with up to four
  answers: a tap, a click or keys 1–4 (`talkKey`). Talking never pauses
  walking, and `TALK_LEAVE_M` ends a talk. A `tell` posts `POST
  /api/spatial/told`; a `do` starts a vision.
- **The Hallway** (`game/hallway.ts`). `Director` sees the player within
  `HALLWAY_DOOR_M` of the door, and `Game.pocket` takes over: a one-room map
  through `buildPhysicsWorld`, `HallwayWalk` for the far door, the clock and
  `HALLWAY_MAX_S`. **`Game.body` never moves**, so the pose pump, the voice
  link and the cameras keep reading the door's room, and the find, the King,
  the void, the heart and the pickups are off because they all stand behind
  the same check. The house's floors, the trail, the duck and the ghosts are
  hidden (never `house.root`: its hemisphere and sun would leave the light
  count), and the pool's first light is lent to the pocket
  (`HouseLamps.borrow`). `leaveHallway` puts them at the door, facing away
  from it, and runs first on a remap and on any session end.
- **It never stops a walk.** A find, a hit, the void, the heart and the disk
  don't read any of this. An escape calls `Director.interrupt`, a find
  `stopDescent`. Gerald's `found` line plays with the egg, never for a refused
  find.

The guests' play help never describes any of this.

### The run reset (wave 59)

For a player stuck on geometry. **R** held for `RESET_HOLD_MS` (5 s,
`game/reset.ts`) fills a bar; letting go, a blur, ⌘ or a held walk empties it,
and it fires once per press. The keys held say it, and a key typed in a field
never reaches them (`typingIn`, read through the tent laptop's shadow root).
It teleports to the current map's spawn at once, whatever the server says,
then posts `POST /api/spatial/reset` and adopts the new duck. The Hallway ends
first and any vision or talk stops; a void's scare finishes first. The
training, the clock, the path reveal, the level and the visit's hit stay as
they were, so a reset in the training stays in the training.

## 4. The terminals — world view

`TerminalConfig` gains `spot` (a `house.terminals[].id`; the terminal's
place) and `view: "auto" | "world" | "face" | "mirror" | "tv" | "chess"`:

- `auto` (default): the attract screen's face pane becomes the **world view**
  while the terminal is linked (below), and the face comes back when it is
  not (and always while piloting — the face is the voice).
- `world`: the world view on the attract screen, also only while linked.

**Linked by room** (wave 26, R5; `terminal/src/world/presence.ts`
`linkedNow`). A placed terminal shows and transmits the Internet — the
world view, its camera into the game (§2.3), its mic to and from the
players (§2.4) — only while a reinstalled player is in its spot's room in
the game. The server judges: the screen state's `spot.here` counts the
players whose presence room is that spot's room (§2.2). With several
players every occupied room is linked. A terminal with no `spot`, and the
tent's `reinstall` station, are never linked; `mirror` and `shadow` stay
house-wide; the TV (`desktop-tv`) follows the walls' rule. Only when the
server sends no `here` (an older server) does a terminal fall back to the
old house-wide rule. A client latch (`PRESENCE_LINGER_MS`, 3 s: on at
once, off after 3 s unlinked) keeps a doorway crossing from flickering.
- `face`: today's terminal.
- `mirror`: a full-screen spectator: no scanner, no chat.
- `tv` (`Tv.tsx`, OCT31 K-18): the TV above the fireplace, run by the house
  Mac's Chrome over HDMI — the character's face speaking every line it says
  in the TV's room (`room=`, default The Desktop) in the Mac's own voice
  (the server's `/api/mod/tts` is an opt-in);
  song beats and lore speakers are captioned only, nothing is said while
  the character is hidden or asleep.
- `chess` (wave 11, `terminal/src/chess/`, on `@loom/chess`): **the King's
  chess board**, the only place he is played — the Server Door terminal
  on the basement hall wall outside the real server-room door (the
  `server-room-door` spot). Awake all night (it never follows the
  character's hidden / asleep), no `character`, `room` ignored. Attract:
  THE KING, his shared bar off the screen state's `king` (*n / max*, *HE
  KNEELS* at 0), the stakes line (`armed` true: *Checkmate him.* — since
  wave 26 it names no prize up front; false: *No prize now.*) and
  the scanner — never a strength line, never a hint. A pass is checked
  through the moderator lens (`GET /api/state?role=guest&as=<id>`; a
  restricted program: *⛔ Marked programs can't challenge the King.*);
  one game per scan, the board dealt at `stageFor(hp, max)` read **at
  the deal** (full = grandmaster, 1 … max−1 club / beginner / dizzy, only
  0 pawns only; `PROFILES` in `@loom/chess/ai.ts`); the player is White,
  tap-tap, auto-queen, a two-tap Give up, a 120 s leash that abandons
  silently. Its end posts `POST /api/mod/signal {name: "chess won" |
  "chess lost" | "chess drawn", subject: <guest id>, label: "Terminal ·
  <name>"}` with its moderator token (retried 0.5 → 8 s, 5 s an attempt,
  a 4xx final; kept in `localStorage` while in flight and re-sent on the
  next boot only within 60 s). *Checkmate. The door code is in your
  phone's Codex.* only once the win landed while `armed` and the story
  took it; a 200 with `refused: true` (after truth.txt or an ending)
  reads *Checkmate. No prize now.*; a win that never landed says *tell a
  host (♟)*.

Every view polls the lean screen state (`GET /e/:id/api/screen/state`,
`core/server/routes/screen.ts`; every 2 s, the TV every 1 s) instead of
the mod feed: the screen cues, attract mode (the character hidden or asleep → screensaver /
ads, never "ONLINE", no pass piloting), the countdown, the TV's lines, the shared King (`king: {hp, max, fallen,
armed} | null` — `armed` off his prop's `armed` world var at or above its
`min`, null with no such rule or no story; null when the map has no King),
and a heartbeat the editor's Run → Terminals card reads (the device's health
rides the poll's query: sound unlocked, visible, battery, full screen
`fs=1|0` since wave 17 — ⛶ on the card when not —, build). Since wave 17
it also carries the house-wide story **`moments`** (beats, admin cues,
picks, finds; ≤ 12, live only) and the public **`night`** vars the
cutscenes draw from (`terminal/src/cutscene/`). While nobody pilots a
terminal it plays a client-side **idle show** (screensavers, ads,
popups) — asleep, with nothing that names the character; awake, with the
scanner shrunk to a corner scan box — and the server's `attract` keeps
meaning only "the character is hidden or asleep". Every terminal asks for
full screen on every tap while it isn't (`terminal/src/fullscreen.ts`;
[`docs/trapped/kiosk.md`](./trapped/kiosk.md)). A tablet without
**WebGL2** (probed once at boot, `terminal/src/webgl.ts`) behaves as
`face` and never loads three.js; a `mirror` shows a still notice.

The world view shows the King too — `buildHouseScene` draws every `king`
prop and a closed leaf in each guarded door, and the view calls
`HouseScene.showKing` with the stream's shared `KingState` (`hello`,
`king` frames): his bar, the kneel and his door open for everyone while
he is fallen, and then Trabolta's heart in the server room (wave 26; the
virus disk is never drawn on a terminal). A terminal only watches; nothing it does hits him. Ghosts
are swarms of the guest's profile picture (`PlayerState.avatar`, `avatar`
frames), in the mount, follow, mirror and shadow views alike.

The world view (`terminal/src/world/`) renders through `@loom/house/three`
with one camera, cut by a pure director (`world/director.ts`): **mount**
(the camera at the terminal's spot, looking along its yaw/pitch, with the
spot's *vertical* `fov` or `DEFAULT_SPOT_FOV` — a window into the virtual
copy of this very room) for every placed terminal, always: since wave 26
a linked wall shows the world only while its room is occupied (above),
so it always mounts; **follow** (over the shoulder of the most recently
active player, with their room named; a find wins) is only for an
unplaced terminal, such as a house-wide `mirror` with no `spot`; **orbit**
(a slow circle of the spawn room) for an unplaced one with nobody
playing; a corner **mini-map** of the floor with every player's
dot and the terminal's cone `horizontalFov` wide; a `duck` frame moves
that player's unfound duck on screen; name tags over ghosts; a banner "REINSTALLATION IN
PROGRESS · <name> · <room>"; a celebration on `found` (a kept find —
`captured` true, nothing released — reads "GERALD CAN'T HELP" with a
plain border and no egg). Rendering is capped
at 30 fps and pauses when hidden; poses are interpolated ~120 ms behind.
Provision: `/terminal/?code=…&name=Kitchen&character=Trabolta&spot=start-bar&view=auto`.

## 5. The VR game — `reinstall/vr/` (Godot 4.7, Quest 3)

- `project.godot`: OpenXR on, XR shaders on, Mobile renderer, ETC2/ASTC,
  `startup_alert=false`, physics 90 Hz, `[audio] driver/enable_input=true`
  and (wave 26) `general/text_to_speech=true` (without it
  `tts_get_voices()` is empty); `export_presets.cfg` "Quest" (Gradle
  build, `xr_mode` OpenXR, the Meta vendor plugin for Quest 3, arm64,
  INTERNET permission, no cleartext — the server is HTTPS; built by
  `tools/quest.sh` from a staging copy, which also stamps
  `config/build.json` with the short commit — `+` for a dirty tree — and
  the UTC time, never in the working tree). Without an OpenXR
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
  moved — follow the arrows." (just "Gerald moved." before the path
  reveal). **Station-poll re-link:** a 404 on the poll
  (the event ended, or the server forgot it) drops back to the lobby and
  re-resolves the passcode to whatever event it names now; no answer at all
  for 5 s shows "Lost the server — retrying…".
- **In-headset setup** (wave 19): a station whose passcode is missing or the
  committed `CHANGEME` (and not `--offline`) shows **SET UP THIS HEADSET**
  in the lobby (`game/setup_panel.gd`) instead of a dead status line: the
  server choices (`StationConfig.server_choices`: a server named on the
  command line, the committed `res://` one, and **This computer ·
  127.0.0.1:7000** (`http://127.0.0.1:7000`) only on an editor / desktop run —
  `OS.has_feature("editor_runtime")` or not Android — and first on an editor
  run that names no server of its own), an on-screen keyboard
  of the passcode alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` with ⌫ and
  SPACE (physical keys too on a desktop: Tab switches field, Enter
  connects), the station name (default "Headset <4 hex>", the hex of the
  station id it mints), **CONNECT** and — on an editor / desktop run only —
  **PLAY OFFLINE** (on a headset it would be a guest's way into a game
  nobody is released from). CONNECT is `ServerLink.try_setup`: resolve-code
  must answer `role: "mod"`, then the mod login; a refusal says "No event on
  <server> answers to that passcode." (404) or "That isn't a moderator
  passcode." (another role, a 401 / 403 login), no answer or any other
  status "Can't reach the server.", and the station stays unconfigured
  with no retry loop. A working one is saved by `StationConfig.save_user`
  to `user://station.json` (never `res://`: the Quest preset ships
  `config/*.json`) with a minted station id `vr-<name>-<4 hex>`, and the
  link carries on with no restart (`configure` / `reconnect`; an epoch
  drops a connect answer for an older configuration). PLAY OFFLINE is for
  that run only. A ⚙ in the lobby (shown when there is a saved setup or
  offline was chosen) held 2 s (5 s on a headset build, where the hover
  hint is not shown: a guest must not take a show headset out of service)
  calls `forget_setup`: the file is deleted and the panel comes back. A
  **configured** station whose passcode stops working — a 404, not a
  moderator's, a refused login (the staff codes rotated, the event gone) —
  shows SET UP again, its own server first, instead of retrying for ever; a
  network error or a 5xx still retries, and while the link is down the
  lobby says its status rather than "Nobody is marked…".
- **Found:** the game claims the duck within 0.9 m of it in plan, when the
  feet are within 1.2 m of its height (`HouseDuck.DUCK_MAX_RISE`) or on its
  floor — the server's `nearDuck` rule, tighter in plan.
- `house/house_builder.gd` + `house_geometry.gd` + `house_route.gd` +
  `house_locate.gd`: the §1.2 algorithms in GDScript → StaticBody3D walls,
  floors (with stair holes), ramps, rails, props, terminal screens, labels.
  A `king` prop is drawn as a gold body with a crown and his shared
  health bar, with a shut leaf in each door he guards; a guarded door is
  shut for `house_route.gd` as for `route` (never a portal) while he
  stands. Wave 26: Trabolta's heart is a dark rack with a slowly beating
  red core behind a smoked front, no label, rows or coloured lights, shown
  only while the King has fallen (always on a map with none); the virus
  disk is a 3.5" floppy spinning and bobbing with a green glow, hidden
  once this program took it (`set_pickup_taken`, kept across rebuilds).
  Neither collides. The outside ground (`_build_ground`) is the same rect
  as `outsideGround`. `house_escape.gd` (`HouseEscape`) and
  `house_moment.gd` (`HouseMoment`) port the §1.1 moment rules, and
  `HouseLocate.presence_room` / `linked_spots` the presence ones, pinned by
  the `escape`, `presence` and `moments` goldens.
- **The King** (wave 11, `house/house_king.gd`: `kingReach`, the fallen
  map, `KingState` off the wire): the bar over his head ("THE KING  n /
  15") from `hello`, `king` frames and the session's map fetch is his only
  display — the HUD never carries his hit points (wave 26, R3; a check in
  `test/game.gd`). Near him the HUD says "Pull the trigger to hit the
  King." The
  **trigger** (either hand) or **A / X**, within `KING_REACH` and facing
  him (`KING_CONE_DEG`), flushes the newest pose and posts `POST
  /api/spatial/king/hit`; "You hit him." — one hit per reinstallation
  visit (the server's 409 `already hit` counts as spent; an assignment's
  `kingHit` starts the visit spent, and the HUD says "You hit him this
  reinstallation. Find Gerald before you hit him again."). At 0 he kneels
  for everyone: his collider and the leaf go, the trail routes through
  the door, the HUD says "He is down: the cold door is open." A
  director's restore stands him up and shuts the door — except for a
  player behind it, in the doorway or on his spot, for whom it stays open
  until they are clear (`HouseKing.keep_door_open`, the web game's
  `keepDoorOpen`); `respawn_after_remap` judges standing room on the
  fallen map. No chess in the headset. A server with no shared King shows
  no bar and takes no hit.
- **Ghosts are swarms of the guest's profile picture** (`game/ghosts.gd`,
  `game/swarm.gd`, `game/swarm.gdshader`, `net/avatar_cache.gd`):
  two downloads at a time off the event's `/api/avatar/<key>`, 2 MB cap,
  decoded by magic bytes (PNG / JPEG / WebP / SVG — an SVG rendered once
  near 256 px whatever size it declares; GIF / AVIF stay static),
  cached for the run; a failure is retried once on the next visit.
- **The voice link** (wave 19, `net/voice_codec.gd` + `net/voice_link.gd`,
  §2.4): `voice_codec.gd` is a literal port of `@loom/house` `voice.ts`
  (μ-law with a 256-entry decode table, the integer-phase resampler, the
  gate + half-duplex hold, the chunker, `jitter_plan`, `voice_on`), pinned
  by `test/golden/voice-mulaw.json`. While a session plays the game holds
  `GET …/api/spatial/voice/stream?token=<session>` on `SseClient`; each
  heard terminal plays from an `AudioStreamPlayer3D` "Voice" under its
  `Terminal_<id>` (`HouseBuilder.voice_emitter`, re-made after a rebuild)
  on a 16 kHz `AudioStreamGenerator` (1 s buffer), attenuation off,
  `volume_db` from the frame's `gain`; 200 ms of jitter target, a skip
  ahead to it past 400 ms queued, a 10 ms fade-in and a 60 ms fade-out on
  `bye`; a terminal the map has voice off (the tent) is never played. The
  mic: `AudioServer.set_input_device_active(true)` + `get_input_frames()`
  at `get_input_mix_rate()` (an `AudioStreamMicrophone` on a muted
  `VoiceMic` bus with an `AudioEffectCapture` when that gives nothing for
  2 s), resampled to 16 kHz, 200 ms chunks, μ-law, the −42 dBFS gate
  (400 ms hang, one chunk of pre-roll), held while the game plays a sound
  or a line of its own (`VoiceLink.hold_for(ms)`, + 300 ms; wave 26). Uploads only while `listen.on` (the stream's `hello` /
  `listen`, the POST's `listening`), on one persistent keep-alive
  `HTTPClient` (`request_raw`, `x-loom-token`, `?seq=`), one POST in flight,
  two chunks a POST at most, at most 1 s queued (older chunks dropped),
  reconnecting with a back-off and reopening a connection idle 4 s. A
  401 / 403 / 410 stops the uploads until the next session. **B / Y**
  (`by_button`, either hand; **M** on the desktop rig) toggles the mic, but
  only while it is open (a press while it is asking, refused or missing
  changes nothing). Since wave 26 the HUD's line names every state with no
  emoji and says what to do (`VoiceLink.hud_text`): *MIC ON · someone can
  hear you* / *MIC ON · B or Y mutes*, *MIC MUTED · press B or Y*, *MIC ·
  allow it in the headset's prompt*, *NO MIC · not allowed · ASK AGAIN in
  the lobby* (the new `denied` state, a refused grant), *MIC STARTING…*,
  *NO MIC*. Every mic change prints one `reinstall-vr: mic — …` line
  (`tools/quest.sh logs`). The Quest preset's
  `permissions/record_audio=true`, the grant asked in the lobby, before any
  session (`VoiceLink.prime_permission`: the system dialog pauses the app,
  which in a session would end it; a dialog still up at a start arms no
  away deadline while the mic is "asking"), the mic re-opened on
  `on_request_permissions_result`. While a terminal plays here the gate is
  raised, not held (D5b, §2.4). Config `voice` / `mic` (both on;
  `--mic false` listens only). Everything stops in `enter_lobby`;
  offline there is none.
- **Camera feeds** (`net/cam_feeds.gd`, §2.3): `spots_to_poll` picks the
  listed terminals in the player's presence room
  (`HouseLocate.presence_room`, never the tent's station), the nearest
  `MAX_FEEDS`; there is no range any more. It does not add the 3 s linger:
  the hysteresis matches the server's, and the server decides.
- **Sound** (wave 26, R8, `game/sfx.gd`, `Sfx`): synthesised like the web
  game's (no assets): Gerald's quack, positional on the duck at the web
  game's schedule and never delayed by the path reveal; the fanfare (a
  find, his fall); the "no" buzz (once per approach, and not for closed
  doors or a parked session); the King's thud; the scare; a pickup blip;
  and a quiet hum while playing. All play on an `Sfx` bus. Every one-shot
  holds the mic for its length (`played` → `VoiceLink.hold_for`); the hum
  holds nothing but pauses while a terminal listens, so no game sound
  reaches the mic.
- **In-game speech** (wave 26, `game/speech.gd`, `Speech`): a moment's
  lines are captioned one at a time, head-locked under the HUD, or for the
  heart on a billboard over it, each for its reading time with
  `LINE_GAP_MS` (700 ms) between lines, and no speaker's name. The device
  voice (`DisplayServer.tts_speak`, volume 100) says `pronounce` of the
  line (`res://config/pronounce.json`, a copy of the terminal's table;
  A–Z case folding); with no device voice (`tts_get_voices()` empty) the
  captions alone carry them. A voice stuck 4 s past its reading time is
  cut. The mic is held while it speaks.
- **The path reveal and the moments** (wave 26; `game/game.gd`; §3 *The
  moments* for the rules): the trail is hidden for the first minute of
  each walk (config `trail_delay` seconds, `--trail-delay`, default
  `HouseRoute.PATH_REVEAL_MS`; dev runs and tests may set 0), the HUD
  saying just "find Gerald"; then "A golden trail flickers on." and the
  trail. The autopilot ignores the delay. **The void**: out through the
  exterior door, `ESCAPE_M` past the walls, the walk freezes, one hard
  glitch flash (*FATAL EXCEPTION 0E*, a noise, a haptic pulse; never any
  camera motion), `link.moment("escape")`, and on the answer (at most 3 s)
  the player is back at the spawn, the answer's lines spoken. The teleport
  happens whatever the server says. Within 20 s of its own last post
  (wall time) the void puts them back quietly: no scare, no post.
  **The heart**: reached `HEART_INSET_M` inside its room once the King has
  fallen, a heart moment; his lines play over it; no lines retry on the
  next way in; `already` or `heartHeard` is silent for the night.
  **The disk**: within `PICKUP_REACH_M`, a pickup moment; taken (or
  `already`, or in `picked`) it goes with a blip and the answer's lines.
  The link claims per kind (`moment:escape`, `moment:heart`,
  `moment:pickup`, the prop id kept with the claim), flushes the newest
  pose first, and reads errors by their `error` string; any 404 but `no
  such prop` is an old server. A refused heart or pickup retries after
  `MOMENT_RETRY` (1.5 s).
- `player/`: XROrigin3D rig on a CharacterBody3D; **left stick** walks
  head-relative (dead zone 0.15, 1.4 m/s, no acceleration), **right
  stick** turns smoothly about the head, `|x|^1.6` × 70°/s (wave 33b: no
  snap turn — its jumps made people dizzy — and no `smooth_turn`
  setting). With the left stick idle (the show's headsets have only the
  right controller) the right stick's forward / back walks too, its weaker
  axis dropped unless the push is a real diagonal (`Locomotion.axis_lock`,
  0.5; once in, an axis holds down to 0.3, so a push near the edge never
  flickers turning on and off). The rig (turn, walk, gravity, room
  scale) moves every rendered frame, on a headset by exactly one display
  interval per frame (`VrPlayer.frame_step`; physics ticks drift against
  the display, and the measured frame time is noisy: both snap the view);
  after a teleport the body waits two physics ticks for new floors.
  `main.gd` asks for the offered rate nearest 90 Hz (start, session begun,
  focus) and sets the physics tick to the display's rate; the Quest 3 has
  so far stayed at 72 Hz. The game logs its frame timing every 10 s. Foveation stays level 3; MSAA on
  `medium` drew a black void on the Quest 3 (2026-10-29). A body under the lobby's or the
  intro's floor is put back on it (`Game._catch_fall`, logged).
  A comfort vignette closes while moving or turning (turning to
  0.85); walking into a wall gives a light haptic buzz (at most every
  0.6 s); room-scale head offset folded into the body. The buttons are the King's
  hit (trigger, or A / X; on a Mac, Space or F) and the voice link's mute
  (B / Y; on a Mac, M), both only while playing. In the lobby
  `player/pointer.gd` (`LobbyPointer`) casts a **laser** from each hand's
  aim pose (an `XRController3D` on the `aim` pose, the hand's own transform
  until it tracks): a thin teal beam with a gold dot where it meets the
  panel (`LobbyTiles.ray_to_panel`); the trigger (a click, or pulled past
  0.8, let go under 0.4) presses; the other hand takes the beam by a fresh
  trigger pull or by moving now (over 30°/s or 0.15 m/s for 0.15 s), never
  by drift and never while the beam hand's trigger is held. On the desktop
  rig the
  mouse is the pointer (the camera's ray through it, the left button the
  press; never captured in the lobby, and the camera levelled on entry) and
  there is no beam.
- `game/`: lobby (a dark room; wave 19: **PICK YOUR PROGRAM** — a picture
  tile per eligible program, `Lobby.eligible_only`: its profile picture off
  the ghosts' `AvatarCache` (initials until it lands), its name, its tag
  *[corrupted]* / *[marked]* / *[party favour]*; one row up to 4, two rows
  up to 8, then pages of 4 × 2 with ◀ ▶ (`LobbyTiles.layout`). Point the
  laser and pull the trigger, click (desktop), or the stick
  (`CandidatePicker` on a grid: up / down a row, left one back, a right
  flick let go early one on, **hold right 1 s** picks); a card asks
  **"Start as <name>?"** with **START** / **BACK** (the same three ways,
  Enter / Backspace on a desktop; the hold that opened it must let go
  first) and START calls `begin` with the headset's mod token, so the tent
  tablet is not needed. "Nobody is marked for reinstallation yet." for an
  empty list; "this headset: <name>" and the connection state above the
  tiles; a card closes when its program leaves the list, and every return
  to the lobby clears it. The tablet's *Send to headset* lands whatever the
  view. A begin 409 `not marked for reinstallation` flashes *Not marked for
  reinstallation.*; a 404 *Nobody has that pass.*; wave 26: to its left, in every
  view, the **MICROPHONE** box — what the mic is doing and what to do
  about it (`VoiceLink.lobby_text`), **TEST MIC** (the mic open with no
  session and no uplink, a level meter, closing itself after 30 s or when
  a program starts), **ASK AGAIN** while the grant is missing or refused
  (a refusal with "don't ask again" leaves only the headset's Settings →
  Apps → Permissions), and the build stamp, *build <sha> · <UTC>* from
  `config/build.json` or *build dev* on an editor run, so the crew can tell
  an old APK from a new one),
  play (duck, indicator trail, ghosts), found (egg, flight, "Reinstallation
  complete"; a find the story kept — nothing released, still captured —
  says "GERALD CAN'T HELP" and the duck stays put; a find by a program that
  was never captured releases nobody too, and reads "YOU FOUND GERALD"
  with the egg and the flight, as on the tablet), back to lobby. Headset off (`user_presence_changed`) ends the
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
  refetch, duck adoption, the setup's answers + save + forget), the found
  rule, the lobby's tiles / laser / confirm card / setup panel / mic box on
  `main.tscn` with a fake link, the wave 26 moments, sounds, speech and
  path reveal, and the autopilot reaching every show duck spot
  kinematically and with real collision, and (wave 39) the real lights
  and the graphics tiers (1208 checks, plus 42 for `quest.sh`, among them
  the `text_to_speech` setting, the build stamp and `--graphics`).
- **Not proven on hardware** (wave 26): whether Horizon OS has a TTS voice
  (without one the headset only captions) and whether the Quest's mic
  delivers real samples. The device check (HW-TENT-07) settles both: the
  lobby's TEST MIC, `tools/quest.sh logs` for the `reinstall-vr: mic —`
  lines, and a game line spoken aloud, not only captioned.
- **Editor runs** (wave 19): F5 with no arguments reaches SET UP THIS
  HEADSET (then the tiles, once `user://station.json` holds a passcode)
  with no script errors; the OpenXR loader's "no runtime" errors and
  *Godot will start in normal mode* are harmless (`startup_alert=false`).
  The lobby prints each view to the log. Debug → Customize Run Instances →
  Main Run Args takes the command-line flags after `--`. See
  `reinstall/vr/README.md` → *Run it from the Godot editor*.

### The run reset (wave 59)

The web game's, on both triggers + A held for `HoldMeter.RESET_HOLD` (5 s), with
a bar in the HUD. Two of the index and grip triggers count (`VrPlayer.chord`), so
the show's one right controller can do it with index, grip and A, and two
controllers with one index each and A; X counts as A. In the house only: the intro
has no geometry to be stuck on, and the reset never goes back through it.
`Game._run_reset` teleports at once, and `LinkBase.reset_run` brings the new duck
through `duck_changed` (dealt locally offline). Pressing any one of those buttons
near the King is still a hit, so a chord started beside him can spend it.

### The intro (wave 33)

Before every walk the headset leaves the lobby for a calm practice floor
away from the house, and the guest watches *The Reinstallation Process*
on a cinema screen (3.6 m wide, 3.4 m ahead, at eye height, in the dark).
The video ships inside the APK as `media/reinstallation.ogv` (Ogg Theora
720p30 + Vorbis, decoded in software; `export_presets.cfg` includes
`media/*.ogv`); a missing or undecodable file is skipped. Then a gentle
tutorial for the one right controller (`game/intro_flow.gd`, pure;
`game/intro_space.gd`), one step at a time, each moving on when the guest
does the thing, with a soft chime and a light haptic, and a fallback
button for anyone stuck:

1. look around (OK after 5 s);
2. point the beam at OK and pull the trigger (A works too);
3. push the stick forward into a glowing ring (NEXT after 20 s);
4. turn round (the stick, or just the body) to face a duck behind them;
   it moves on 2 s after they face it (NEXT after 20 s);
5. a comfort line ("stop, stand still, close your eyes") and START.

Both are unskippable until the assignment's `reinstalled` ≥ 1; then SKIP
and SKIP TUTORIAL appear. VR ignores the assignment's `prefs` since
wave 33b (there is no turn setting). Throughout the intro the spawn pose goes out every frame, so the session
stays alive, and nothing of the walk runs: no void, find, King, voice
link, hum or quack (the video's sound never reaches the mic). At START the
guest is placed at the spawn, the path reveal and quack clocks start, and
`mark_ready()` posts `POST /api/spatial/ready` (an old server's 404 is
ignored). A session that ends mid-intro stops the video and returns to the
lobby. `intro: false` (`--intro false`) skips it; `--autopilot` never
plays it. The copy was signed off on 2026-10-28. Unproven on hardware: Theora at 720p30
beside 90 Hz rendering, the video's level, the panel's comfort.

### The real house's lights and the graphics tiers (wave 39)

The spatial stream's `lights` frame (§2.2, `GameLights`) reaches the game
through `LinkBase.lights_changed` and `LinkBase.lights` (the latest; `{}`
once the link drops or is reconfigured). `house/house_lights.gd`
(`HouseLights`) is the literal port of `gameLightsOf` (a malformed light is
dropped, not the frame; an unknown frame is ignored as before) and
`pulseFactor` (1 → 0.35 → 1 every 2 s), pinned in `test/game.gd` to what
the TS answers for the same inputs. `house/house_lamps.gd` (`HouseLamps`)
draws it:

- **A bulb per fixture**: an unshaded sphere and an additive glow quad at
  its `pos`, in its `color` × `level`; a dark fixture is a grey bulb with
  no glow. A fixture with `pulse` breathes with `pulseFactor`, counted from
  when it started. (The real pulse is the server's and stagehand's; this is
  the game showing it.)
- **A fixed pool of `OmniLight3D`s** (no shadows): 2 / 4 / 5 by tier, made
  once, re-picked four times a second onto the lit fixtures (level > 0.02)
  nearest the player on their floor (`HouseLights.pick_pool`); a light
  keeps its fixture while it stays picked; unused ones are hidden. The
  Mobile renderer lights a mesh with at most 8 omni lights (it drops the
  rest), and the duck, the heart and the disk carry one each: `high` stops
  at 5 so a large floor mesh never loses one, least of all the duck's.
- **The ambient**: while a frame is in and the player walks the house (not
  the lobby, not the intro), the environment's ambient (0.55 today) and the
  sun (0.7) ease (≈ 1.5 s) toward a night floor of 0.24 / 0.22, lifted back
  up to 40 % of the way by the real house's mean level and tinted by its
  level-weighted colour (`HouseLights.ambient`). No frame — an old server,
  no lights module, the link gone — is today's house.

`graphics` in `station.json` (`low | medium | high`, default `medium`; also
`--graphics`, and `tools/quest.sh build|station|provision … --graphics`)
picks the picture (`HouseLook.environment(tier)`, `HouseLook.msaa`,
`HouseLook.set_tier`):

| | real lights | shading | tone map | glow | MSAA |
|---|---|---|---|---|---|
| low | 2 | per vertex | ACES (white 2.0) | off | off |
| medium | 4 | per pixel (Lambert, no specular) | ACES | off | off |
| high | 5 | per pixel | ACES | on (screen, threshold 0.7) | 2× |

No tier has SSAO, SSR, SSIL, SDFGI or volumetric fog. Comfort is unchanged.
Unproven on hardware: whether Quest 3 holds 90 Hz on `medium` (per-pixel
shading with four lights is the one new cost; `low` is the fallback) and
on `high`.

### The descent (wave 49)

The contract is `docs/loom-w49-contract.md` C2 and C6; the rules are
`@loom/house` `descent.ts`, ported literally to `house/house_descent.gd` and
pinned by `test/golden/descent.json`. A walk's level is `descentOf(assignment)`
(`descent`, else `reinstalled`, capped at 4), overridden on a headset by
`--descent N` / `descent` in `station.json`, or the lobby's mirror combo
(`AABBABABBAA`: offline, level 4). **Level 0 is the game unchanged**: nothing
is built, fetched or touched.

`game/descent.gd` is the runner over `descentPlan` + `dueBeat` on the walk's
clock (from the intro's end), one vision at a time. A beat is held by an
escape, a talk, a held or suspended walk, a running vision, the King within
3 m, or the Hallway; one that can't be drawn is skipped. `descentLook` is on for
the whole walk (fog, ambient, tint, the neon's period). Visions are unshaded
meshes built once at the first deep walk, or the existing light: `flicker` dips
the ambient, the pool and the neon (at most 3 Hz), `tint` eases a wrong colour
into them, `dark` pulls a black fog in to about 3 m. The pool stays fixed; no
vision adds a light, a shadow or a shader. Deeper than level 0 the neon's
stutter is one soft dip, however often it comes: the 14 Hz shiver of
`neonFlicker` stays on level 0 alone. `small` / `big` scale
`XROrigin3D.world_scale` about the head (the camera's height on the desktop
rig), eased over `ALICE_EASE_S`; poses, the body and reach stay the real ones.
`self` needs the assignment's `avatar` picture, already fetched.

Talkers: `wakeTalkers` picks the props, each with a face on `faceAnchor`,
drawn within 8 m on the player's floor. `talkReach` opens a talk at `openNode`
(with the assignment's `told`); the lines go through `Speech` with the prop's
node as the anchor, then `game/talk_panel.gd` shows one row per option, near the
prop, turned to the player, chosen with `LobbyPointer`. The beam shows only
while a panel is open. A pull held since before the panel picks nothing. A
press on a row is swallowed: it never hits the King; off the rows the trigger
hits him as ever. `pickOption`'s `tell` posts `POST /api/spatial/told`, its
`do` sets off a vision (now, or when the running one ends). Past `TALK_LEAVE_M`
the talk ends, dropping only that prop's lines (`Speech.cancel`), and the talker
stays quiet until the player has left and come back.

The Hallway: `doorSpot` stands the door; within `HALLWAY_DOOR_M` the player is
teleported to `game/hallway.gd`, a corridor off the map built once with its own
floor and wall colliders, its one light following them and the house's light
down to almost nothing. `_tick_play` returns early, the shape of
`_tick_escape`: the pose at the door still goes out, voice and cams follow the
door's room, and the void, the heart, pickups, the King and the find are off;
the house, ghosts, lamps, trail and duck are hidden. The far door backs away at
`HALLWAY_RETREAT` × the player's forward pace for `HALLWAY_RETREAT_S`, then
stays. Reaching it, `HALLWAY_MAX_S`, a fall (it never should) or a find that
was already out bring them back at the door they entered, facing away from it;
a remap restores the house before it rebuilds; a session end goes to the lobby
through the same close. `Game._catch_fall` plays no part: it watches only the
lobby and the intro.

The words: `fetch_descent()` at each walk (`GET /api/spatial/descent`, the
session's token), never waited for; a 404, `{script: null}`, a script that fails
`validateDescent` or no answer means the bundled `res://house/descent.json`
(`pnpm house:sync`). `found` is said at the find. With neither, the visions play
in silence and nobody talks. `--autopilot` ignores all of it and never goes
through the door. Not proven on hardware: `world_scale` easing on the Quest 3
(the view, the hands, the beam), its frame rate through a `dark` or the Hallway,
and whether Horizon OS speaks the lines at all (captions carry them either way).

## 6. The story

The goose is now the **golden duck** (`INTERACTION the golden duck`,
`CODEX The Golden Duck`) and nothing needs a button: "walk to the duck".
`the simulation completed` still releases a corrupted program; the
games fire both events for whoever finds the duck.

**The game moments** (wave 26, `main.loom`; §2.1 `POST
/api/spatial/moment`). Each is a `who: admin` signal for the program,
quiet on the screens (`QUIET_MOMENT_SIGNALS`):

- `when simulation escape attempt for program:` adds one to
  `program.escapes`, recomputes `program.trust` (the C9 formula: each
  escape is −5), tells `# hosts`, and plays *Escape Attempt*: Trabolta
  chastising, every time, even before his reveal. It is a game-only beat,
  so its lines reach only the game's answer, never a phone.
- `when simulation heart reached for program:` once a night per program
  (`program.sim_heart`) and only while Trabolta is awake: tells `# hosts`
  and plays *Heart In The Simulation*, a short monologue in his fiction
  (game-only too). Flavour only. A visit before he is awake says nothing,
  so the game asks again on the next visit.
- `when simulation pickup taken for program:` with `item == "virus"`, for
  a program not yet carrying it, unlocks the same codex entry the tent's
  printed QR gives (which entry depends on the program; the printed QRs
  stay as the backup). The existing `learns` rules then do the rest. The
  disk is never a plant: only the existing plant rule counts for a quest,
  and it refuses inside the Internet.

The escape's and the heart's lines (and their `# hosts` readouts) are on
`SIGNOFF-w26.md`, signed off on 2026-10-27.

**The King** speaks to the story two ways (wave 11).

- **Hits, from the games, through the server** (§2.1 `POST
  /api/spatial/king/hit`): the journaled `set Night.king_hp = hp − 1`,
  then `king hit` for the guest with `{hp, max}`, then at 0 `king
  fallen`, all `by` the game's device. The show's `when king_hit for
  program:` reads `Night.king_hp` (never the args) for a `# hosts`
  readout and a house-wide line at 10 and 5; `when king_fallen for
  program:` alerts everyone. Neither ever sets `Night.king_hp`; the
  admin 👑 `restore_the_king` sets it back to `Night.king_hp_max`.
  `Night.king_armed` is 1 from Power On until `Night.r3_closed` or
  `Night.ended`, then 0 (the prop's `armed`, the screen state's
  `king.armed`).
- **Chess results, from the Server Door terminal** (§4 `chess`):
  `POST /api/mod/signal {name, subject, label}` with its moderator
  token — `chess won` (the mate), `chess lost`, `chess drawn`, `subject`
  = the program playing. The server honours `label` only when the
  caller's `by` is the generic "Director" — a mod-token device, never an
  author's session — and journals the signal `by` that label (the same
  rule as `/api/mod/impersonate`), so the journal line reads `by:
  "Terminal · Server Door"`. `when chess_won for program:` unlocks *The
  Door Code* for the winner, once, **any time before `Night.r3_closed`**
  (no practice any more; a duplicate or a fire with no subject only
  notes `# hosts`; after 📄 a win only tells `# hosts`). `chess lost` /
  `chess drawn` post a `# hosts` readout every time and, once Trabolta
  is awake, make him gloat at most once every five minutes, never from
  the final reveal (`-> Chess Lost` / `-> Chess Drawn`). The fallbacks
  stay: **♟ They beat the machine** on the winner's card
  (`beat_the_machine` → `fire chess_won`, `arm: true`), the admin
  `chess_won` INTERACTION, or the director firing `chess won` from Run.
