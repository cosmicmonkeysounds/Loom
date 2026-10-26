//! "Follow the indicators" — `docs/loom-reinstall.md` §1.2 "Route". A
//! shortest walkable path through doors and stairs, as waypoints for the
//! golden chevron trail: a visibility graph over the portals plus corner
//! waypoints (each reflex corner of a room, each corner of a stair rect,
//! each corner of a solid prop's grown bounds), so no leg cuts through a
//! wall, across a stair hole, or through a solid prop. Deliberately plain
//! O(n²) Dijkstra (houses have a few dozen nodes) so the GDScript port is
//! line-for-line.

import { distanceToBoundary, pointInPolyStrict, propSolid, roomById, roomElevation, stairEnds } from "./geometry.ts";
import { withFallenKings } from "./king.ts";
import { locate } from "./locate.ts";
import type { HouseMap, Portal, Prop, Room, Vec2, Vec3 } from "./types.ts";

/** A plan rect `[x0, z0, x1, z1]`. */
export type Rect = [number, number, number, number];

/** How far a corner waypoint sits off its corner, along each axis. */
export const ROUTE_CLEARANCE = 0.35;
/** How much a stair rect shrinks to become an obstacle (so its own foot / head see out). */
export const OBSTACLE_SHRINK = 0.01;
/** The one tolerance of the visibility test (metres, and m² for orientations). */
export const ROUTE_EPS = 1e-6;
/** How much a solid prop's footprint bounds grow to become an obstacle (the walker's body radius). */
export const PROP_MARGIN = 0.25;
/** (wave 26, R2) The games hide the path to Gerald — the chevron trail, the
 *  compass pip, the distance and the warmer / colder ladder — for this long
 *  from the start of each game session (client side; a re-scan restarts
 *  it), then draw it at once. Gerald's quack is never delayed. */
export const PATH_REVEAL_MS = 60_000;

/** Round to integer micrometres, `floor(v · 1e6 + 0.5) / 1e6` — so trig ulps never reach a decision. */
export function um(v: number): number {
  return Math.floor(v * 1e6 + 0.5) / 1e6 + 0;
}

/**
 * A solid prop's route obstacle: the axis-aligned bounds of its footprint —
 * a cylinder's `max(w, d) / 2` radius box, a box's `w × d` rectangle yawed
 * about `pos` (half extents `hx = |w/2·cos r| + |d/2·sin r|`,
 * `hz = |w/2·sin r| + |d/2·cos r|`, `r = yaw·π/180`) — grown by
 * `PROP_MARGIN` on every side and rounded to 1 µm (`um`).
 */
export function propObstacle(prop: Prop): Rect {
  const [w, , d] = prop.size;
  let hx: number;
  let hz: number;
  if (prop.kind === "cylinder") {
    hx = Math.max(w, d) / 2;
    hz = hx;
  } else {
    const r = ((prop.yaw ?? 0) * Math.PI) / 180;
    const c = Math.abs(Math.cos(r));
    const s = Math.abs(Math.sin(r));
    hx = (w / 2) * c + (d / 2) * s;
    hz = (w / 2) * s + (d / 2) * c;
  }
  const [x, , z] = prop.pos;
  return [um(x - hx - PROP_MARGIN), um(z - hz - PROP_MARGIN), um(x + hx + PROP_MARGIN), um(z + hz + PROP_MARGIN)];
}

/** A route graph node: a portal (door / stair foot / head) or a corner waypoint (in one room). */
export interface RouteNode {
  kind: Portal["kind"] | "corner";
  /** The door or stair id; for a corner, its room's id. */
  id: string;
  pos: Vec3;
  rooms: string[];
}

/**
 * The portals, in order: every door (its point at its floor's elevation,
 * rooms `a` and `b`), then per stair its foot (in `from`) and head (in `to`).
 */
export function portals(house: HouseMap): Portal[] {
  const out: Portal[] = [];
  for (const door of house.doors) {
    out.push({
      kind: "door",
      id: door.id,
      pos: [door.at[0], roomElevation(house, door.a), door.at[1]],
      rooms: door.b === null ? [door.a] : [door.a, door.b],
    });
  }
  for (const stair of house.stairs) {
    const { foot, head } = stairEnds(stair);
    out.push({ kind: "foot", id: stair.id, pos: [foot[0], roomElevation(house, stair.from), foot[1]], rooms: [stair.from] });
    out.push({ kind: "head", id: stair.id, pos: [head[0], roomElevation(house, stair.to), head[1]], rooms: [stair.to] });
  }
  return out;
}

/** Point in polygon, the boundary (± `ROUTE_EPS`) counting as inside. */
function insidePoly(poly: Vec2[], p: Vec2): boolean {
  return distanceToBoundary(poly, p) <= ROUTE_EPS || pointInPolyStrict(poly, p);
}

/**
 * A room's corner waypoints: each reflex vertex `v` (vertex order) moved to
 * `v − 0.35 · (u_prev + u_next)`, where `u_prev` / `u_next` are the unit
 * vectors from `v` toward its two neighbours — for a rectilinear corner,
 * 0.35 m into the room along each axis. Kept only when inside the room.
 */
export function reflexWaypoints(poly: Vec2[]): Vec2[] {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = poly[(i + n - 1) % n]!;
    const v = poly[i]!;
    const q = poly[(i + 1) % n]!;
    const cross = (v[0] - p[0]) * (q[1] - v[1]) - (v[1] - p[1]) * (q[0] - v[0]);
    // Reflex: the turn goes against the winding (a straight vertex is not).
    if (cross === 0 || cross > 0 === area > 0) continue;
    const lp = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const lq = Math.hypot(q[0] - v[0], q[1] - v[1]);
    if (lp === 0 || lq === 0) continue;
    const w: Vec2 = [
      v[0] - ROUTE_CLEARANCE * ((p[0] - v[0]) / lp + (q[0] - v[0]) / lq),
      v[1] - ROUTE_CLEARANCE * ((p[1] - v[1]) / lp + (q[1] - v[1]) / lq),
    ];
    if (insidePoly(poly, w)) out.push(w);
  }
  return out;
}

/** The four corners of a rect moved `ROUTE_CLEARANCE` outward along each axis, `[x0, z0] [x1, z0] [x1, z1] [x0, z1]` order. */
function outerCorners(r: readonly [number, number, number, number]): Vec2[] {
  const c = ROUTE_CLEARANCE;
  return [
    [r[0] - c, r[1] - c],
    [r[2] + c, r[1] - c],
    [r[2] + c, r[3] + c],
    [r[0] - c, r[3] + c],
  ];
}

/**
 * The route graph's nodes, in order: the portals (`portals`) — every door
 * but a guarded one (`Door.guard`: shut until its king falls, so no route
 * crosses it), then per room
 * (array order) its reflex waypoints (`reflexWaypoints`), then per stair
 * (array order) the four corners of its rect moved 0.35 m outward along
 * each axis (`[x0, z0] [x1, z0] [x1, z1] [x0, z1]` order) — first as waypoints of the upper room (`to`,
 * round the hole), then of the lower room (`from`, round the ramp), each
 * only when inside that room; then per solid prop (array order) the four
 * corners of its obstacle (`propObstacle`) moved 0.35 m outward along each
 * axis, same order, as waypoints of the prop's room — each only when inside
 * that room and strictly inside none of its obstacles (`roomObstacles`). A
 * waypoint stands at its room's floor elevation and is in that room only.
 */
export function routeNodes(house: HouseMap): RouteNode[] {
  // A guarded door (`Door.guard`, a king standing in it) is shut for routing:
  // its portal is left out, so nothing paths through it. Once its king has
  // fallen (the shared bar at 0) it is open for everyone: `route()`'s
  // `fallen` option routes over `withFallenKings`, a copy without the guard.
  const guarded = new Set(house.doors.filter((d) => d.guard !== undefined).map((d) => d.id));
  const out: RouteNode[] = portals(house)
    .filter((p) => !(p.kind === "door" && guarded.has(p.id)))
    .map((p) => ({ ...p, pos: [...p.pos] as Vec3, rooms: [...p.rooms] }));
  const corner = (room: Room, w: Vec2) =>
    out.push({ kind: "corner", id: room.id, pos: [w[0], roomElevation(house, room), w[1]], rooms: [room.id] });
  for (const room of house.rooms) for (const w of reflexWaypoints(room.poly)) corner(room, w);
  for (const stair of house.stairs) {
    const [x0, z0, x1, z1] = stair.rect;
    const corners = outerCorners([x0, z0, x1, z1]);
    for (const id of [stair.to, stair.from]) {
      const room = roomById(house, id);
      if (!room) continue;
      for (const w of corners) if (insidePoly(room.poly, w)) corner(room, w);
    }
  }
  for (const prop of house.props) {
    if (!propSolid(prop)) continue;
    const room = roomById(house, prop.room);
    if (!room) continue;
    const obstacles = roomObstacles(house, room.id);
    for (const w of outerCorners(propObstacle(prop))) {
      if (insidePoly(room.poly, w) && !obstacles.some((r) => inOpenRect(r, w))) corner(room, w);
    }
  }
  return out;
}

/**
 * A room's obstacles, in order: the rect of every stair it is the upper or
 * lower room of (array order), shrunk by 0.01 m; then every solid prop of
 * the room (`prop.room`, array order) as its `propObstacle`, not shrunk.
 */
export function roomObstacles(house: HouseMap, room: string): Rect[] {
  const out: Rect[] = [];
  for (const s of house.stairs) {
    if (s.to !== room && s.from !== room) continue;
    const [x0, z0, x1, z1] = s.rect;
    out.push([x0 + OBSTACLE_SHRINK, z0 + OBSTACLE_SHRINK, x1 - OBSTACLE_SHRINK, z1 - OBSTACLE_SHRINK]);
  }
  for (const p of house.props) if (p.room === room && propSolid(p)) out.push(propObstacle(p));
  return out;
}

/** `(b − a) × (c − a)` in plan. */
function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Strictly opposite signs, each beyond `ROUTE_EPS`. */
function opposite(s: number, t: number): boolean {
  return (s > ROUTE_EPS && t < -ROUTE_EPS) || (s < -ROUTE_EPS && t > ROUTE_EPS);
}

/** `ab` and `cd` cross at a single point interior to both (touching / collinear is not a crossing). */
export function properlyCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return opposite(orient(a, b, c), orient(a, b, d)) && opposite(orient(c, d, a), orient(c, d, b));
}

/**
 * Whether the segment `ab` runs through the open rect `[x0, z0, x1, z1]`:
 * Liang–Barsky clips it to the closed rect, and the clipped part must be
 * longer than `ROUTE_EPS` (a segment along an edge line, or touching a
 * corner, does not count).
 */
export function segmentHitsRect(a: Vec2, b: Vec2, rect: readonly [number, number, number, number]): boolean {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const ps = [-dx, dx, -dz, dz];
  const qs = [a[0] - rect[0], rect[2] - a[0], a[1] - rect[1], rect[3] - a[1]];
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 4; k++) {
    const p = ps[k]!;
    const q = qs[k]!;
    if (p === 0) {
      if (q <= ROUTE_EPS) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) t1 = t;
  }
  return (t1 - t0) * Math.sqrt(dx * dx + dz * dz) > ROUTE_EPS;
}

/**
 * Whether `a` sees `b` inside `room`: the plan segment properly crosses no
 * edge of the room's polygon, its midpoint is in the polygon (boundary
 * counts), and it runs through none of the room's obstacles — except an
 * obstacle containing `a` or `b` (strictly), which is ignored (someone
 * standing on a stair, a duck on the counter).
 */
export function visibleIn(house: HouseMap, room: Room, a: Vec3, b: Vec3): boolean {
  const pa: Vec2 = [a[0], a[2]];
  const pb: Vec2 = [b[0], b[2]];
  const poly = room.poly;
  for (let i = 0; i < poly.length; i++) {
    if (properlyCross(pa, pb, poly[i]!, poly[(i + 1) % poly.length]!)) return false;
  }
  if (!insidePoly(poly, [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2])) return false;
  for (const r of roomObstacles(house, room.id)) {
    if (inOpenRect(r, pa) || inOpenRect(r, pb)) continue;
    if (segmentHitsRect(pa, pb, r)) return false;
  }
  return true;
}

function inOpenRect(r: readonly [number, number, number, number], p: Vec2): boolean {
  return p[0] > r[0] && p[0] < r[2] && p[1] > r[1] && p[1] < r[3];
}

export function distance3(a: Vec3, b: Vec3): number {
  const x = a[0] - b[0];
  const y = a[1] - b[1];
  const z = a[2] - b[2];
  return Math.sqrt(x * x + y * y + z * z);
}

/** Whether nodes `i` and `j` are joined: foot↔head of one stair, or a shared room in which they see each other. */
function adjacent(house: HouseMap, ns: RouteNode[], i: number, j: number): boolean {
  const a = ns[i]!;
  const b = ns[j]!;
  if ((a.kind === "foot" && b.kind === "head") || (a.kind === "head" && b.kind === "foot")) {
    if (a.id === b.id) return true;
  }
  for (const r of a.rooms) {
    if (!b.rooms.includes(r)) continue;
    const room = roomById(house, r);
    if (room && visibleIn(house, room, a.pos, b.pos)) return true;
  }
  return false;
}

/** `route()`'s options. */
export interface RouteOptions {
  /** The ids of the kings who have fallen: the doors they guard are open and
   *  they are no longer obstacles (`withFallenKings`). */
  fallen?: ReadonlySet<string>;
}

/**
 * `[from, …node points, to]`. An unlocatable end ⇒ `[from, to]`; the same
 * room and visible ⇒ `[from, to]`; no path ⇒ `[from, to]`.
 *
 * Dijkstra from a virtual start (joined to every node of the start room it
 * sees) to a virtual end (joined from every node of the end room that sees
 * it); weights are 3-D distances. Nodes settle in order of (distance,
 * index) — the end node's index is after every node — and relaxation is
 * strict `<`, so ties go to the lower node index. With `opts.fallen`, over
 * `withFallenKings(map, opts.fallen)`.
 */
export function route(map: HouseMap, from: Vec3, to: Vec3, opts: RouteOptions = {}): Vec3[] {
  const house = opts.fallen === undefined ? map : withFallenKings(map, opts.fallen);
  const a = locate(house, from).room;
  const b = locate(house, to).room;
  if (a === null || b === null) return [from, to];
  const roomA = roomById(house, a);
  const roomB = roomById(house, b);
  if (!roomA || !roomB) return [from, to];
  if (a === b && visibleIn(house, roomA, from, to)) return [from, to];

  const ns = routeNodes(house);
  const n = ns.length;
  const end = n;
  const dist: number[] = new Array<number>(n + 1).fill(Infinity);
  const prev: number[] = new Array<number>(n + 1).fill(-1);
  const done: boolean[] = new Array<boolean>(n + 1).fill(false);
  for (let i = 0; i < n; i++) {
    if (ns[i]!.rooms.includes(a) && visibleIn(house, roomA, from, ns[i]!.pos)) dist[i] = distance3(from, ns[i]!.pos);
  }

  for (;;) {
    let u = -1;
    for (let i = 0; i <= n; i++) {
      if (done[i] || dist[i] === Infinity) continue;
      if (u < 0 || dist[i]! < dist[u]!) u = i;
    }
    if (u < 0 || u === end) break;
    done[u] = true;
    const du = dist[u]!;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u || !adjacent(house, ns, u, v)) continue;
      const d = du + distance3(ns[u]!.pos, ns[v]!.pos);
      if (d < dist[v]!) {
        dist[v] = d;
        prev[v] = u;
      }
    }
    if (ns[u]!.rooms.includes(b) && visibleIn(house, roomB, ns[u]!.pos, to)) {
      const d = du + distance3(ns[u]!.pos, to);
      if (d < dist[end]!) {
        dist[end] = d;
        prev[end] = u;
      }
    }
  }

  if (dist[end] === Infinity) return [from, to];
  const chain: Vec3[] = [];
  for (let i = prev[end]!; i >= 0; i = prev[i]!) chain.unshift([...ns[i]!.pos]);
  return [from, ...chain, to];
}

/** The yaw (degrees, §1 convention) of the plan heading from `a` to `b`. */
export function yawToward(a: Vec3, b: Vec3): number {
  return (Math.atan2(-(b[0] - a[0]), -(b[2] - a[2])) * 180) / Math.PI + 0;
}

/** Total length of a polyline. */
export function pathLength(path: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distance3(path[i - 1]!, path[i]!);
  return total;
}

/**
 * Points every `step` metres along a polyline (from its start, excluding
 * it), each with the heading of its leg as a yaw — the chevron trail.
 */
export function sampleTrail(path: Vec3[], step = 0.75): { p: Vec3; yaw: number }[] {
  const out: { p: Vec3; yaw: number }[] = [];
  let carry = step;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const len = distance3(a, b);
    if (len <= 0) continue;
    const yaw = yawToward(a, b);
    let s = carry;
    while (s <= len) {
      const f = s / len;
      out.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], yaw });
      s += step;
    }
    carry = s - len;
  }
  return out;
}
