//! Procedural geometry from a house map — `docs/loom-reinstall.md` §1.2,
//! normative: the Godot port (`reinstall/vr/house/house_geometry.gd`) is
//! diffed against `buildWalls` through the goldens. Keep every step literal.
//!
//! Wall maths runs in **integer millimetres** (`mmi`), so breakpoints,
//! merges and door cuts compare exactly; every output number is
//! `mmi(raw) / 1000`. `mmi(v) = floor(v · 1000 + 0.5)` (JS `Math.round`;
//! GDScript `int(floor(v * 1000.0 + 0.5))` — not `round()`, which rounds
//! half away from zero).

import type {
  Compass,
  Door,
  Floor,
  FloorPlane,
  HouseMap,
  Prop,
  Ramp,
  Room,
  Stair,
  Vec2,
  Vec3,
  WallKind,
  WallSegment,
} from "./types.ts";

/** Plan tolerance for "on the boundary" tests. */
export const EPS = 1e-9;
/** Default fence height. */
export const DEFAULT_FENCE = 1.0;
/** Default (rendering-only) wall thickness. */
export const DEFAULT_WALL_THICKNESS = 0.1;
/** Default door height. */
export const DEFAULT_DOOR_HEIGHT = 2.0;
/** Stair rail height. */
export const RAIL_HEIGHT = 1.0;
/** How far a door point may sit off its wall line. */
export const DOOR_TOLERANCE = 0.02;

/** Integer millimetres. */
export function mmi(v: number): number {
  return Math.floor(v * 1000 + 0.5);
}

/**
 * Whether a door coordinate `coord` (m) lies on the wall line at `cMm`
 * (integer mm — the line's `round(c · 1000)`, §1.2 step 2), within
 * `DOOR_TOLERANCE`. `buildWalls` step 5 and `validateHouse` both use it so
 * a validated door is always cut.
 */
export function onDoorLine(cMm: number, coord: number): boolean {
  return Math.abs(cMm - coord * 1000) <= DOOR_TOLERANCE * 1000 + 1e-6;
}

/** Round to 1 mm (never `-0`). */
export function mm(v: number): number {
  return mmi(v) / 1000 + 0;
}

// ── Lookups ──────────────────────────────────────────────────────────

export function floorById(house: HouseMap, id: string): Floor | undefined {
  return house.floors.find((f) => f.id === id);
}

export function roomById(house: HouseMap, id: string): Room | undefined {
  return house.rooms.find((r) => r.id === id);
}

/** A room's floor elevation (0 for an unknown room / floor). */
export function roomElevation(house: HouseMap, room: Room | string): number {
  const r = typeof room === "string" ? roomById(house, room) : room;
  return (r && floorById(house, r.floor)?.elevation) ?? 0;
}

/** A room's height: its own, else its floor's. */
export function roomHeight(house: HouseMap, room: Room): number {
  return room.height ?? floorById(house, room.floor)?.height ?? 0;
}

/** Style with the defaults filled. */
export function styleOf(house: HouseMap): { fence: number; wallThickness: number; doorHeight: number } {
  return {
    fence: house.style?.fence ?? DEFAULT_FENCE,
    wallThickness: house.style?.wallThickness ?? DEFAULT_WALL_THICKNESS,
    doorHeight: house.style?.doorHeight ?? DEFAULT_DOOR_HEIGHT,
  };
}

/** Whether a prop collides: `solid`, else true for box / cylinder / king. */
export function propSolid(prop: Prop): boolean {
  // (wave 49) A prop that exists only for some programs never blocks anyone.
  if (prop.from !== undefined) return false;
  return prop.solid ?? (prop.kind === "box" || prop.kind === "cylinder" || prop.kind === "king");
}

/**
 * Whether a plan point is inside a prop's footprint (boundary counts): a
 * cylinder's disc (radius `max(w, d) / 2`) or a box's yawed `w × d`
 * rectangle about `pos` — the shapes the games collide with.
 */
export function inPropFootprint(prop: Prop, p: Vec2): boolean {
  const [w, , d] = prop.size;
  const rx = p[0] - prop.pos[0];
  const rz = p[1] - prop.pos[2];
  if (prop.kind === "cylinder") return Math.hypot(rx, rz) <= Math.max(w, d) / 2 + EPS;
  // Into the prop's frame (inverse of its yaw about +y).
  const r = ((prop.yaw ?? 0) * Math.PI) / 180;
  const lx = rx * Math.cos(r) - rz * Math.sin(r);
  const lz = rx * Math.sin(r) + rz * Math.cos(r);
  return Math.abs(lx) <= w / 2 + EPS && Math.abs(lz) <= d / 2 + EPS;
}

// ── Plan helpers (rectilinear polygons; any simple polygon works) ─────

/** Distance from a plan point to the segment `a → b`. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const z = a[1] + t * dz - p[1];
  return Math.sqrt(x * x + z * z);
}

/** Distance from a plan point to the polygon's boundary. */
export function distanceToBoundary(poly: Vec2[], p: Vec2): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = distanceToSegment(p, poly[i]!, poly[(i + 1) % poly.length]!);
    if (d < best) best = d;
  }
  return best;
}

/** Point in polygon; the boundary counts as inside. */
export function pointInPoly(poly: Vec2[], p: Vec2): boolean {
  if (distanceToBoundary(poly, p) <= EPS) return true;
  return pointInPolyStrict(poly, p);
}

/** Point in polygon by crossing number (a point exactly on the boundary may go either way). */
export function pointInPolyStrict(poly: Vec2[], p: Vec2): boolean {
  let inside = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if (a[1] > p[1] !== b[1] > p[1]) {
      const x = ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

/** Point in `[x0, z0, x1, z1]`; the boundary counts. */
export function pointInRect(rect: readonly [number, number, number, number], p: Vec2): boolean {
  return p[0] >= rect[0] - EPS && p[0] <= rect[2] + EPS && p[1] >= rect[1] - EPS && p[1] <= rect[3] + EPS;
}

/** Point strictly inside `[x0, z0, x1, z1]` (the open rect — a stair hole). */
export function pointInRectStrict(rect: readonly [number, number, number, number], p: Vec2): boolean {
  return p[0] > rect[0] + EPS && p[0] < rect[2] - EPS && p[1] > rect[1] + EPS && p[1] < rect[3] - EPS;
}

/** The rect as a 4-point polygon, plan order `[x0,z0] [x1,z0] [x1,z1] [x0,z1]`. */
export function rectPoly(rect: readonly [number, number, number, number]): Vec2[] {
  return [
    [rect[0], rect[1]],
    [rect[2], rect[1]],
    [rect[2], rect[3]],
    [rect[0], rect[3]],
  ];
}

/** Signed shoelace area (positive = counter-clockwise in the x→z plane). */
export function polyArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Axis-aligned bounds `[x0, z0, x1, z1]`. */
export function polyBounds(poly: Vec2[]): [number, number, number, number] {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [x, z] of poly) {
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
}

/** Sorted distinct coordinates at 1 mm (for cell decompositions). */
export function breakpoints(values: number[]): number[] {
  const keys = [...new Set(values.map(mmi))].sort((a, b) => a - b);
  return keys.map((k) => k / 1000);
}

// ── Stairs ───────────────────────────────────────────────────────────

/** 0 at the foot edge → 1 at the `up` edge, clamped. */
export function rampFraction(rect: readonly [number, number, number, number], up: Compass, p: Vec2): number {
  const [x0, z0, x1, z1] = rect;
  let f: number;
  if (up === "n") f = (z1 - p[1]) / (z1 - z0);
  else if (up === "s") f = (p[1] - z0) / (z1 - z0);
  else if (up === "e") f = (p[0] - x0) / (x1 - x0);
  else f = (x1 - p[0]) / (x1 - x0);
  return Math.max(0, Math.min(1, f));
}

/** The stair's low (`from` floor) and high (`to` floor) elevations. */
export function stairLevels(house: HouseMap, stair: Stair): { low: number; high: number } {
  return { low: roomElevation(house, stair.from), high: roomElevation(house, stair.to) };
}

/** Ramp surface height at a plan point (clamped to the rect's span). */
export function rampHeight(house: HouseMap, stair: Stair, p: Vec2): number {
  const { low, high } = stairLevels(house, stair);
  return low + (high - low) * rampFraction(stair.rect, stair.up, p);
}

/** Centres of the foot edge (opposite `up`) and the head edge (`up`), in plan. */
export function stairEnds(stair: Stair): { foot: Vec2; head: Vec2 } {
  const [x0, z0, x1, z1] = stair.rect;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const n: Vec2 = [cx, z0];
  const s: Vec2 = [cx, z1];
  const e: Vec2 = [x1, cz];
  const w: Vec2 = [x0, cz];
  if (stair.up === "n") return { foot: s, head: n };
  if (stair.up === "s") return { foot: n, head: s };
  if (stair.up === "e") return { foot: w, head: e };
  return { foot: e, head: w };
}

// ── buildWalls (§1.2 steps 1–7) ──────────────────────────────────────

type Axis = "x" | "z";

/** A wall piece in integer millimetres (the working form of `WallSegment`). */
interface Piece {
  floor: string;
  axis: Axis;
  c: number;
  lo: number;
  hi: number;
  bottom: number;
  top: number;
  kind: WallKind;
}

interface Edge {
  floor: string;
  axis: Axis;
  c: number;
  lo: number;
  hi: number;
  room: Room;
}

/**
 * The house's walls, fences, door lintels and stair rails as axis-aligned
 * segments — deterministic and sorted (floor order, axis, c, lo, kind, then
 * hi, top).
 */
export function buildWalls(house: HouseMap): WallSegment[] {
  const style = styleOf(house);

  // 1. Edges.
  const edges: Edge[] = [];
  for (const room of house.rooms) {
    const n = room.poly.length;
    for (let i = 0; i < n; i++) {
      const p = room.poly[i]!;
      const q = room.poly[(i + 1) % n]!;
      const px = mmi(p[0]);
      const pz = mmi(p[1]);
      const qx = mmi(q[0]);
      const qz = mmi(q[1]);
      if (px === qx && pz === qz) continue;
      if (pz === qz) {
        edges.push({ floor: room.floor, axis: "x", c: pz, lo: Math.min(px, qx), hi: Math.max(px, qx), room });
      } else if (px === qx) {
        edges.push({ floor: room.floor, axis: "z", c: px, lo: Math.min(pz, qz), hi: Math.max(pz, qz), room });
      }
      // a diagonal edge is not a wall (validateHouse refuses it)
    }
  }

  // 2. Lines, in first-seen order (the output is sorted at the end).
  const lines = new Map<string, Edge[]>();
  for (const e of edges) {
    const key = `${e.floor}|${e.axis}|${e.c}`;
    const line = lines.get(key);
    if (line) line.push(e);
    else lines.set(key, [e]);
  }

  // 3–4. Elementary pieces, merged.
  const pieces: Piece[] = [];
  for (const line of lines.values()) {
    const first = line[0]!;
    const floor = floorById(house, first.floor);
    const elevation = floor?.elevation ?? 0;
    const bottom = mmi(elevation);
    const cuts = [...new Set(line.flatMap((e) => [e.lo, e.hi]))].sort((a, b) => a - b);
    const run: Piece[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u = cuts[i]!;
      const v = cuts[i + 1]!;
      let height = -Infinity;
      let allOutdoor = true;
      let any = false;
      for (const e of line) {
        if (e.lo > u || e.hi < v) continue;
        any = true;
        if (e.room.outdoor) {
          height = Math.max(height, style.fence);
        } else {
          allOutdoor = false;
          height = Math.max(height, e.room.height ?? floor?.height ?? 0);
        }
      }
      if (!any) continue;
      const piece: Piece = {
        floor: first.floor,
        axis: first.axis,
        c: first.c,
        lo: u,
        hi: v,
        bottom,
        top: mmi(elevation + height),
        kind: allOutdoor ? "fence" : "wall",
      };
      const prev = run[run.length - 1];
      if (prev && prev.kind === piece.kind && prev.top === piece.top && prev.hi === piece.lo) prev.hi = piece.hi;
      else run.push(piece);
    }
    pieces.push(...run);
  }

  // 5. Doors.
  for (const door of house.doors) {
    const room = roomById(house, door.a);
    if (!room) continue;
    const elevation = floorById(house, room.floor)?.elevation ?? 0;
    for (const axis of ["x", "z"] as const) {
      const coord = axis === "x" ? door.at[1] : door.at[0];
      const t = axis === "x" ? door.at[0] : door.at[1];
      const tm = mmi(t);
      let hit = -1;
      let hitDist = Infinity;
      for (let i = 0; i < pieces.length; i++) {
        const s = pieces[i]!;
        if (s.floor !== room.floor || s.axis !== axis) continue;
        if (s.kind !== "wall" && s.kind !== "fence") continue;
        if (!onDoorLine(s.c, coord)) continue;
        const dist = Math.abs(s.c - coord * 1000);
        if (tm < s.lo || tm > s.hi) continue;
        if (dist < hitDist || (dist === hitDist && s.c < pieces[hit]!.c)) {
          hit = i;
          hitDist = dist;
        }
      }
      if (hit < 0) continue;
      const seg = pieces[hit]!;
      const gapLo = Math.max(seg.lo, mmi(t - door.width / 2));
      const gapHi = Math.min(seg.hi, mmi(t + door.width / 2));
      const keep: Piece[] = [];
      if (gapLo > seg.lo) keep.push({ ...seg, hi: gapLo });
      if (seg.hi > gapHi) keep.push({ ...seg, lo: gapHi });
      const doorTop = mmi(elevation + (door.height ?? style.doorHeight));
      if (seg.kind === "wall" && doorTop < seg.top && gapHi > gapLo) {
        keep.push({ ...seg, lo: gapLo, hi: gapHi, bottom: doorTop, kind: "lintel" });
      }
      pieces.splice(hit, 1, ...keep);
      break;
    }
  }

  // 6. Rails.
  for (const stair of house.stairs) {
    const upper = roomById(house, stair.to);
    if (!upper) continue;
    const elevation = floorById(house, upper.floor)?.elevation ?? 0;
    const bottom = mmi(elevation);
    const top = mmi(elevation + RAIL_HEIGHT);
    const [x0, z0, x1, z1] = stair.rect;
    const sides: { side: Compass; axis: Axis; c: number; lo: number; hi: number }[] = [
      { side: "n", axis: "x", c: z0, lo: x0, hi: x1 },
      { side: "s", axis: "x", c: z1, lo: x0, hi: x1 },
      { side: "e", axis: "z", c: x1, lo: z0, hi: z1 },
      { side: "w", axis: "z", c: x0, lo: z0, hi: z1 },
    ];
    for (const s of sides) {
      if (s.side === stair.up) continue;
      pieces.push({
        floor: upper.floor,
        axis: s.axis,
        c: mmi(s.c),
        lo: mmi(s.lo),
        hi: mmi(s.hi),
        bottom,
        top,
        kind: "rail",
      });
    }
  }

  // 7. Output, sorted.
  const order = new Map(house.floors.map((f, i) => [f.id, i]));
  pieces.sort(
    (a, b) =>
      (order.get(a.floor) ?? 0) - (order.get(b.floor) ?? 0) ||
      cmp(a.axis, b.axis) ||
      a.c - b.c ||
      a.lo - b.lo ||
      cmp(a.kind, b.kind) ||
      a.hi - b.hi ||
      a.top - b.top,
  );
  return pieces.map((s) => ({
    floor: s.floor,
    axis: s.axis,
    c: s.c / 1000 + 0,
    lo: s.lo / 1000 + 0,
    hi: s.hi / 1000 + 0,
    bottom: s.bottom / 1000 + 0,
    top: s.top / 1000 + 0,
    kind: s.kind,
  }));
}

/**
 * The gap a door cuts: the wall axis + line it sits on (room `a`'s own
 * edge, mm-rounded like `buildWalls` step 2) and the gap's `lo..hi`
 * (`mmi(t ± width / 2)`, as step 5 cuts it on a validated map), with
 * `bottom` = the room's floor elevation and `top` = the door top. Null when
 * no edge of room `a` carries the door (± `DOOR_TOLERANCE`). `kind` is
 * `"wall"`; `floor` is room `a`'s. The games stand a closed leaf in it.
 */
export function doorGap(house: HouseMap, door: Door): WallSegment | null {
  const room = roomById(house, door.a);
  if (!room) return null;
  const elevation = floorById(house, room.floor)?.elevation ?? 0;
  const style = styleOf(house);
  const n = room.poly.length;
  let best: { axis: Axis; c: number; dist: number } | null = null;
  for (const axis of ["x", "z"] as const) {
    const coord = axis === "x" ? door.at[1] : door.at[0];
    const t = axis === "x" ? door.at[0] : door.at[1];
    const tm = mmi(t);
    for (let i = 0; i < n; i++) {
      const p = room.poly[i]!;
      const q = room.poly[(i + 1) % n]!;
      const pAlong = mmi(axis === "x" ? p[0] : p[1]);
      const qAlong = mmi(axis === "x" ? q[0] : q[1]);
      const pAcross = mmi(axis === "x" ? p[1] : p[0]);
      const qAcross = mmi(axis === "x" ? q[1] : q[0]);
      if (pAcross !== qAcross || pAlong === qAlong) continue;
      if (!onDoorLine(pAcross, coord)) continue;
      if (tm < Math.min(pAlong, qAlong) || tm > Math.max(pAlong, qAlong)) continue;
      const dist = Math.abs(pAcross - coord * 1000);
      if (best === null || dist < best.dist || (dist === best.dist && pAcross < best.c)) best = { axis, c: pAcross, dist };
    }
    if (best !== null) break;
  }
  if (best === null) return null;
  const t = best.axis === "x" ? door.at[0] : door.at[1];
  return {
    floor: room.floor,
    axis: best.axis,
    c: best.c / 1000 + 0,
    lo: mmi(t - door.width / 2) / 1000 + 0,
    hi: mmi(t + door.width / 2) / 1000 + 0,
    bottom: mmi(elevation) / 1000 + 0,
    top: mmi(elevation + (door.height ?? style.doorHeight)) / 1000 + 0,
    kind: "wall",
  };
}

/** Code-point string order (GDScript `<` on String). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Walls grouped by floor id (every floor present, possibly empty). */
export function wallsByFloor(house: HouseMap, walls: WallSegment[] = buildWalls(house)): Map<string, WallSegment[]> {
  const out = new Map<string, WallSegment[]>(house.floors.map((f) => [f.id, []]));
  for (const w of walls) out.get(w.floor)?.push(w);
  return out;
}

/** A wall segment's plan end points `[a, b]`. */
export function wallEnds(w: WallSegment): [Vec2, Vec2] {
  return w.axis === "x"
    ? [
        [w.lo, w.c],
        [w.hi, w.c],
      ]
    : [
        [w.c, w.lo],
        [w.c, w.hi],
      ];
}

// ── buildFloors / buildRamps ─────────────────────────────────────────

/**
 * One floor plane per room at its floor's elevation (holes: the stairs
 * rising into it), and for an indoor room a ceiling at elevation + height
 * (holes: the stairs rising out of it). Triangulation is the engine's.
 */
export function buildFloors(house: HouseMap): FloorPlane[] {
  const out: FloorPlane[] = [];
  for (const room of house.rooms) {
    const elevation = roomElevation(house, room);
    const outdoor = room.outdoor === true;
    const base = { room: room.id, floor: room.floor, poly: room.poly.map((p) => [p[0], p[1]] as Vec2), outdoor };
    const color = room.color !== undefined ? { color: room.color } : {};
    out.push({
      ...base,
      kind: "floor",
      y: elevation,
      holes: house.stairs.filter((s) => s.to === room.id).map((s) => rectPoly(s.rect)),
      ...color,
    });
    if (!outdoor) {
      out.push({
        ...base,
        poly: base.poly.map((p) => [p[0], p[1]] as Vec2),
        kind: "ceiling",
        y: elevation + roomHeight(house, room),
        holes: house.stairs.filter((s) => s.from === room.id).map((s) => rectPoly(s.rect)),
        ...color,
      });
    }
  }
  return out;
}

/** Per stair, the sloped quad. */
export function buildRamps(house: HouseMap): Ramp[] {
  return house.stairs.map((stair) => {
    const { low, high } = stairLevels(house, stair);
    const corner = (p: Vec2): Vec3 => [p[0], low + (high - low) * rampFraction(stair.rect, stair.up, p), p[1]];
    const [a, b, c, d] = rectPoly(stair.rect) as [Vec2, Vec2, Vec2, Vec2];
    return {
      stair: stair.id,
      from: stair.from,
      to: stair.to,
      up: stair.up,
      rect: [...stair.rect],
      low,
      high,
      corners: [corner(a), corner(b), corner(c), corner(d)],
    };
  });
}

/** The open band of a stairwell between two floors (`stairWells`). */
export interface StairWell {
  stair: string;
  /** The floor of the stair's `from` room (the well belongs to it). */
  floor: string;
  /** The stair's rect, `[x0, z0, x1, z1]`: the hole in both planes. */
  rect: [number, number, number, number];
  /** The `from` room's ceiling. */
  bottom: number;
  /** The `to` room's floor. */
  top: number;
}

/**
 * Per stair whose `to` floor sits above the `from` room's ceiling, the band
 * between them: the ceiling's hole and the floor's hole are the same rect,
 * so without four faces round it a climber sees through the gap between
 * the floors into the void. Render-only (no collider).
 */
export function stairWells(house: HouseMap): StairWell[] {
  const out: StairWell[] = [];
  for (const stair of house.stairs) {
    const from = roomById(house, stair.from);
    const to = roomById(house, stair.to);
    if (!from || !to || from.outdoor === true) continue;
    const bottom = roomElevation(house, from) + roomHeight(house, from);
    const top = roomElevation(house, to);
    if (top - bottom > 1e-6) out.push({ stair: stair.id, floor: from.floor, rect: [...stair.rect], bottom, top });
  }
  return out;
}
