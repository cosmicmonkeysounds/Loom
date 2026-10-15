//! Yards — pure. An outdoor room has no roof and fences on every edge, so
//! the tent (or the shed) in the yard is an *indoor* room the yard is cut
//! around (`docs/loom-reinstall.md` §1.1: rooms on a floor never overlap,
//! polygons are rectilinear and have no holes). This module does the cut.
//!
//! **Yard** = every outdoor room on a floor with one label + LOCATION: the
//! pieces of one yard. When an indoor room is drawn, moved or resized over
//! a yard (`settleRoom`), the yard is re-cut (`reflowYard`): its area minus
//! every other room on the floor, decomposed on the grid of every polygon
//! coordinate into cells, then split into as few simple, hole-free
//! rectilinear pieces as it takes (a tent in the middle of a lawn needs
//! two: a hole is not allowed). Pieces keep the yard's label / LOCATION /
//! colour, the biggest keeps the old id, and every pair of touching pieces
//! is joined by a door spanning their whole shared edge — an opening, so
//! the yard still walks as one. Doors into the yard are re-linked to
//! whichever piece they now open on, things standing in it are re-homed,
//! and a free-standing room cut into the yard (the tent, the shed — no
//! indoor room beside it) with no way out gets a door on its side facing
//! the most yard (the tent flap); so does any part of the yard the cut
//! sealed off from everything else. A room that stood *in* the yard
//! (fenced by it on at least half its edge) gives its old footprint back
//! when it moves away or is deleted; a house room that only borders the
//! yard never does.

import { breakpoints, cloneData, distanceToBoundary, mmi, nearFootprint, pointInPoly, pointInPolyStrict, polyBounds, polygonsOverlap, rectPoly, roomAt, roomById } from "@loom/house";
import type { Door, HouseMap, Room, Vec2, Vec3 } from "@loom/house";
import { DOOR_WIDTH, clampGap, doorFloor, fitDoor, pointOn, resolveDoor, round, type WallLine } from "./doors.ts";
import { freshId } from "./ids.ts";
import { snap } from "./plan.ts";

type Rect = [number, number, number, number];

/** How much of its edge a room must share with a yard to count as standing in it. */
export const ISLAND_SHARE = 0.5;
const SIDE = 0.005;

// ── Cells ────────────────────────────────────────────────────────────

/** A cell grid: the cuts along x and z. Cell `k` = column `k % nx`, row `⌊k / nx⌋`. */
export interface Grid {
  xs: number[];
  zs: number[];
}

const nxOf = (g: Grid): number => g.xs.length - 1;
const nzOf = (g: Grid): number => g.zs.length - 1;

/** The grid of every coordinate of `polys` inside `env` (and `env`'s own edges). */
export function gridFor(polys: readonly Vec2[][], env: Rect): Grid {
  const within = (v: number, lo: number, hi: number) => mmi(v) >= mmi(lo) && mmi(v) <= mmi(hi);
  const xs = breakpoints([env[0], env[2], ...polys.flatMap((p) => p.map((v) => v[0]))]).filter((x) => within(x, env[0], env[2]));
  const zs = breakpoints([env[1], env[3], ...polys.flatMap((p) => p.map((v) => v[1]))]).filter((z) => within(z, env[1], env[3]));
  return { xs, zs };
}

function cellCentre(g: Grid, k: number): Vec2 {
  const nx = nxOf(g);
  const i = k % nx;
  const j = Math.floor(k / nx);
  return [(g.xs[i]! + g.xs[i + 1]!) / 2, (g.zs[j]! + g.zs[j + 1]!) / 2];
}

function cellArea(g: Grid, k: number): number {
  const nx = nxOf(g);
  const i = k % nx;
  const j = Math.floor(k / nx);
  return (g.xs[i + 1]! - g.xs[i]!) * (g.zs[j + 1]! - g.zs[j]!);
}

/** The cells whose centre passes `test`. */
export function cellsWhere(g: Grid, test: (c: Vec2) => boolean): Set<number> {
  const out = new Set<number>();
  const n = nxOf(g) * nzOf(g);
  for (let k = 0; k < n; k++) if (test(cellCentre(g, k))) out.add(k);
  return out;
}

/** A cell's 4-neighbours inside the grid. */
function neighbours(g: Grid, k: number): number[] {
  const nx = nxOf(g);
  const nz = nzOf(g);
  const i = k % nx;
  const j = Math.floor(k / nx);
  const out: number[] = [];
  if (i > 0) out.push(k - 1);
  if (i + 1 < nx) out.push(k + 1);
  if (j > 0) out.push(k - nx);
  if (j + 1 < nz) out.push(k + nx);
  return out;
}

/**
 * The boundary of a set of cells as one rectilinear polygon — or null when
 * it is not a single simple polygon (a hole, two pieces, or a pinch where
 * two cells meet only at a corner). Collinear vertices are dropped.
 */
export function traceCells(cells: ReadonlySet<number>, g: Grid): Vec2[] | null {
  if (cells.size === 0) return null;
  const nx = nxOf(g);
  const vx = nx + 1;
  const has = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < nzOf(g) && cells.has(j * nx + i);
  // Directed boundary edges, interior on the left (x → z plane): start vertex → end vertex.
  const out = new Map<number, number>();
  const add = (from: number, to: number): boolean => {
    if (out.has(from)) return false; // two edges leave one vertex: a pinch
    out.set(from, to);
    return true;
  };
  for (const k of cells) {
    const i = k % nx;
    const j = Math.floor(k / nx);
    const v = (a: number, b: number) => b * vx + a;
    if (!has(i, j - 1) && !add(v(i, j), v(i + 1, j))) return null;
    if (!has(i + 1, j) && !add(v(i + 1, j), v(i + 1, j + 1))) return null;
    if (!has(i, j + 1) && !add(v(i + 1, j + 1), v(i, j + 1))) return null;
    if (!has(i - 1, j) && !add(v(i, j + 1), v(i, j))) return null;
  }
  const start = out.keys().next().value as number;
  const loop: number[] = [];
  let at = start;
  do {
    loop.push(at);
    at = out.get(at)!;
  } while (at !== start && loop.length <= out.size);
  if (loop.length !== out.size) return null; // more than one loop: a hole or two pieces
  const pts = loop.map((v): [number, number] => [v % vx, Math.floor(v / vx)]);
  const kept = pts.filter((p, idx) => {
    const a = pts[(idx + pts.length - 1) % pts.length]!;
    const b = pts[(idx + 1) % pts.length]!;
    return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
  });
  return kept.map(([i, j]) => [g.xs[i]!, g.zs[j]!]);
}

/** The 4-connected components of a set of cells (largest first). */
function components(cells: ReadonlySet<number>, g: Grid): Set<number>[] {
  const seen = new Set<number>();
  const out: Set<number>[] = [];
  for (const k of [...cells].sort((a, b) => a - b)) {
    if (seen.has(k)) continue;
    const comp = new Set<number>([k]);
    seen.add(k);
    const stack = [k];
    while (stack.length > 0) {
      const c = stack.pop()!;
      for (const n of neighbours(g, c)) {
        if (cells.has(n) && !seen.has(n)) {
          seen.add(n);
          comp.add(n);
          stack.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** A set of cells as rectangles: x-runs per row, stacked where consecutive rows repeat them. */
function rectangles(cells: ReadonlySet<number>, g: Grid): Set<number>[] {
  const nx = nxOf(g);
  const out: Set<number>[] = [];
  let open = new Map<string, Set<number>>();
  for (let j = 0; j < nzOf(g); j++) {
    const next = new Map<string, Set<number>>();
    let i = 0;
    while (i < nx) {
      if (!cells.has(j * nx + i)) {
        i++;
        continue;
      }
      const i0 = i;
      while (i < nx && cells.has(j * nx + i)) i++;
      const key = `${i0},${i}`;
      const rect = open.get(key) ?? new Set<number>();
      if (!open.has(key)) out.push(rect);
      for (let c = i0; c < i; c++) rect.add(j * nx + c);
      next.set(key, rect);
    }
    open = next;
  }
  return out;
}

function touches(a: ReadonlySet<number>, b: ReadonlySet<number>, g: Grid): boolean {
  for (const k of a) for (const n of neighbours(g, k)) if (b.has(n)) return true;
  return false;
}

/**
 * Split a set of cells into simple, hole-free rectilinear pieces — one per
 * component when it already is one, else its rectangles greedily merged
 * while every merge still traces as one simple polygon. Biggest first.
 */
export function partition(cells: ReadonlySet<number>, g: Grid): Set<number>[] {
  const area = (s: ReadonlySet<number>) => [...s].reduce((sum, k) => sum + cellArea(g, k), 0);
  const first = (s: ReadonlySet<number>) => Math.min(...s);
  const byArea = (a: Set<number>, b: Set<number>) => area(b) - area(a) || first(a) - first(b);
  const out: Set<number>[] = [];
  for (const comp of components(cells, g)) {
    if (traceCells(comp, g) !== null) {
      out.push(comp);
      continue;
    }
    const pieces = rectangles(comp, g);
    for (let merged = true; merged; ) {
      merged = false;
      pieces.sort(byArea);
      outer: for (let a = 0; a < pieces.length; a++) {
        for (let b = 0; b < pieces.length; b++) {
          if (a === b || !touches(pieces[a]!, pieces[b]!, g)) continue;
          const union = new Set([...pieces[a]!, ...pieces[b]!]);
          if (traceCells(union, g) === null) continue;
          pieces[a] = union;
          pieces.splice(b, 1);
          merged = true;
          break outer;
        }
      }
    }
    out.push(...pieces);
  }
  return out.sort(byArea);
}

/** Maximal straight runs of the edge two cell sets share (each a full-edge opening). */
export function sharedEdges(a: ReadonlySet<number>, b: ReadonlySet<number>, g: Grid): { line: WallLine; lo: number; hi: number }[] {
  const nx = nxOf(g);
  const segs: { line: WallLine; lo: number; hi: number }[] = [];
  for (const k of a) {
    const i = k % nx;
    const j = Math.floor(k / nx);
    if (i + 1 < nx && b.has(k + 1)) segs.push({ line: { axis: "z", c: g.xs[i + 1]! }, lo: g.zs[j]!, hi: g.zs[j + 1]! });
    if (i > 0 && b.has(k - 1)) segs.push({ line: { axis: "z", c: g.xs[i]! }, lo: g.zs[j]!, hi: g.zs[j + 1]! });
    if (b.has(k + nx) && j + 1 < nzOf(g)) segs.push({ line: { axis: "x", c: g.zs[j + 1]! }, lo: g.xs[i]!, hi: g.xs[i + 1]! });
    if (j > 0 && b.has(k - nx)) segs.push({ line: { axis: "x", c: g.zs[j]! }, lo: g.xs[i]!, hi: g.xs[i + 1]! });
  }
  segs.sort((p, q) => (p.line.axis < q.line.axis ? -1 : p.line.axis > q.line.axis ? 1 : p.line.c - q.line.c || p.lo - q.lo));
  const merged: typeof segs = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.line.axis === s.line.axis && last.line.c === s.line.c && last.hi === s.lo) last.hi = s.hi;
    else merged.push({ ...s, line: { ...s.line } });
  }
  return merged;
}

// ── Yards ────────────────────────────────────────────────────────────

/** The pieces of the yard `roomId` belongs to (outdoor, same floor, label, LOCATION) — empty for an indoor room. */
export function yardOf(house: HouseMap, roomId: string): string[] {
  const room = roomById(house, roomId);
  if (room === undefined || room.outdoor !== true) return [];
  return house.rooms.filter((r) => r.outdoor === true && r.floor === room.floor && r.label === room.label && r.location === room.location).map((r) => r.id);
}

/** Every yard on a floor, as its pieces' ids. */
export function yardsOn(house: HouseMap, floor: string): string[][] {
  const groups = new Map<string, string[]>();
  for (const r of house.rooms) {
    if (r.floor !== floor || r.outdoor !== true) continue;
    const key = `${r.label}\u0000${r.location ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(r.id);
    else groups.set(key, [r.id]);
  }
  return [...groups.values()];
}

function boundsOf(polys: readonly Vec2[][]): Rect {
  let b: Rect | null = null;
  for (const p of polys) {
    const r = polyBounds(p);
    b = b === null ? r : [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])];
  }
  return b ?? [0, 0, 0, 0];
}

/** The stretches of a room's edges, each with what lies just outside it (a room id or null). */
function outsideRuns(house: HouseMap, room: Room, cutsFrom: readonly Vec2[][]): { line: WallLine; lo: number; hi: number; out: string | null; edge: number }[] {
  const runs: { line: WallLine; lo: number; hi: number; out: string | null; edge: number }[] = [];
  const n = room.poly.length;
  const xs = breakpoints(cutsFrom.flatMap((p) => p.map((v) => v[0])));
  const zs = breakpoints(cutsFrom.flatMap((p) => p.map((v) => v[1])));
  for (let e = 0; e < n; e++) {
    const a = room.poly[e]!;
    const b = room.poly[(e + 1) % n]!;
    let line: WallLine;
    if (a[1] === b[1] && a[0] !== b[0]) line = { axis: "x", c: a[1] };
    else if (a[0] === b[0] && a[1] !== b[1]) line = { axis: "z", c: a[0] };
    else continue;
    const lo = Math.min(line.axis === "x" ? a[0] : a[1], line.axis === "x" ? b[0] : b[1]);
    const hi = Math.max(line.axis === "x" ? a[0] : a[1], line.axis === "x" ? b[0] : b[1]);
    const cuts = [lo, hi, ...(line.axis === "x" ? xs : zs).filter((v) => v > lo && v < hi)].sort((p, q) => p - q);
    // Which side of the edge is outside the room.
    const mid = (lo + hi) / 2;
    const off = pointInPoly(room.poly, pointOn(line, mid, SIDE)) && !pointInPoly(room.poly, pointOn(line, mid, -SIDE)) ? -SIDE : SIDE;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const u = cuts[i]!;
      const v = cuts[i + 1]!;
      if (v - u <= 1e-9) continue;
      const out = house.rooms.find((r) => r.id !== room.id && r.floor === room.floor && pointInPolyStrict(r.poly, pointOn(line, (u + v) / 2, off)))?.id ?? null;
      const last = runs[runs.length - 1];
      if (last && last.edge === e && last.out === out && last.hi === u) last.hi = v;
      else runs.push({ line, lo: u, hi: v, out, edge: e });
    }
  }
  return runs;
}

/** How much of a room's edge the yard `pieces` fence (0 … 1). */
export function yardShare(house: HouseMap, roomId: string, pieces: readonly string[]): number {
  const room = roomById(house, roomId);
  if (room === undefined) return 0;
  const polys = house.rooms.filter((r) => r.floor === room.floor).map((r) => r.poly);
  let total = 0;
  let yard = 0;
  for (const r of outsideRuns(house, room, polys)) {
    total += r.hi - r.lo;
    if (r.out !== null && pieces.includes(r.out)) yard += r.hi - r.lo;
  }
  return total > 0 ? yard / total : 0;
}

/**
 * Re-cut one yard: its pieces plus `vacated` (footprints given back),
 * minus every other room on its floor, within the yard's bounding box —
 * as few simple pieces as it takes, joined by full-edge openings. The map
 * is returned unchanged (the same object) when the yard's area didn't
 * change. Works on a copy.
 */
export function reflowYard(house: HouseMap, pieces: readonly string[], vacated: readonly Vec2[][] = []): HouseMap {
  const rooms = pieces.map((id) => roomById(house, id)).filter((r): r is Room => r !== undefined);
  if (rooms.length === 0) return house;
  const floor = rooms[0]!.floor;
  const others = house.rooms.filter((r) => r.floor === floor && !pieces.includes(r.id));
  const env = boundsOf(rooms.map((r) => r.poly));
  const g = gridFor([...rooms.map((r) => r.poly), ...vacated, ...others.map((r) => r.poly)], env);
  if (nxOf(g) < 1 || nzOf(g) < 1) return house;
  const inYard = (c: Vec2) => rooms.some((r) => pointInPolyStrict(r.poly, c));
  const before = cellsWhere(g, inYard);
  const region = cellsWhere(g, (c) => (inYard(c) || vacated.some((v) => pointInPolyStrict(v, c))) && !others.some((r) => pointInPolyStrict(r.poly, c)));
  if (before.size === region.size && [...before].every((k) => region.has(k))) return house;

  const next = cloneData(house);
  const parts = partition(region, g);
  // Ids: the biggest piece keeps the id of the old piece it overlaps most.
  const taken = new Set<string>();
  const allIds = new Set(next.rooms.map((r) => r.id));
  const made: { room: Room; cells: Set<number> }[] = [];
  for (const cells of parts) {
    const poly = traceCells(cells, g);
    if (poly === null) continue;
    let best: Room | null = null;
    let bestArea = 0;
    for (const old of rooms) {
      if (taken.has(old.id)) continue;
      let a = 0;
      for (const k of cells) if (pointInPolyStrict(old.poly, cellCentre(g, k))) a += cellArea(g, k);
      if (a > bestArea) {
        bestArea = a;
        best = old;
      }
    }
    const template = best ?? rooms[0]!;
    const id = best !== null ? best.id : freshId(rooms[0]!.id, allIds);
    taken.add(id);
    allIds.add(id);
    made.push({ room: { ...cloneData(template), id, poly: poly.map((p) => [round(p[0]), round(p[1])] as Vec2) }, cells });
  }
  const at = next.rooms.findIndex((r) => pieces.includes(r.id));
  next.rooms = next.rooms.filter((r) => !pieces.includes(r.id));
  next.rooms.splice(Math.max(0, at), 0, ...made.map((m) => m.room));

  const yardIds = new Set([...pieces, ...made.map((m) => m.room.id)]);
  // The old openings between pieces go; every touching pair gets one per shared edge.
  next.doors = next.doors.filter((d) => !(yardIds.has(d.a) && d.b !== null && yardIds.has(d.b)));
  const doorIds = new Set(next.doors.map((d) => d.id));
  for (let i = 0; i < made.length; i++) {
    for (let j = i + 1; j < made.length; j++) {
      for (const s of sharedEdges(made[i]!.cells, made[j]!.cells, g)) {
        const id = freshId(`${made[i]!.room.id}-${made[j]!.room.id}`, doorIds);
        doorIds.add(id);
        next.doors.push({ id, a: made[i]!.room.id, b: made[j]!.room.id, at: pointOn(s.line, round((s.lo + s.hi) / 2)), width: round(s.hi - s.lo) });
      }
    }
  }
  settleFloor(next, floor, yardIds);
  return next;
}

/**
 * After a structural change on `floor` (in place, on a copy the caller
 * owns): re-link the doors that open onto a changed room or onto the
 * outside, drop doors to a room that no longer exists, move stairs and
 * re-home things whose room changed or no longer holds them.
 */
export function settleFloor(house: HouseMap, floor: string, touched: ReadonlySet<string>): void {
  const exists = new Set(house.rooms.map((r) => r.id));
  house.doors = house.doors
    .map((d) => {
      const relink = touched.has(d.a) || d.b === null || touched.has(d.b);
      return relink && (doorFloor(house, d) === floor || touched.has(d.a)) ? fitDoor(house, resolveDoor(house, d)) : d;
    })
    .filter((d) => exists.has(d.a) && (d.b === null || exists.has(d.b)));
  // A stair whose end room was re-cut: the room now under its middle.
  for (const s of house.stairs) {
    for (const end of ["from", "to"] as const) {
      if (exists.has(s[end]) || !touched.has(s[end])) continue;
      const r = roomAt(house, [(s.rect[0] + s.rect[2]) / 2, (s.rect[1] + s.rect[3]) / 2], floor);
      if (r !== null) s[end] = r.id;
    }
  }
  const rehome = (thing: { room: string; pos: Vec3 }): void => {
    const own = roomById(house, thing.room);
    if (own !== undefined && own.floor !== floor) return;
    if (own === undefined && !touched.has(thing.room)) return;
    const p: Vec2 = [thing.pos[0], thing.pos[2]];
    // Deep inside another room now (not just on a shared wall): it lives there.
    const inside = house.rooms.find((r) => r.floor === floor && r.id !== thing.room && pointInPolyStrict(r.poly, p) && distanceToBoundary(r.poly, p) > 0.05);
    if (own !== undefined && nearFootprint(own, p) && inside === undefined) return;
    const home = inside ?? roomAt(house, p, floor);
    if (home !== null) thing.room = home.id;
  };
  house.terminals.forEach(rehome);
  house.duck.spots.forEach(rehome);
  house.props.forEach(rehome);
  rehome(house.spawn);
}

/**
 * The tent flap: when `roomId` opens onto none of the yard `pieces`, a
 * door on the stretch of its edge facing the most yard (`DOOR_WIDTH`, or
 * the stretch when shorter), centred on it. Works on a copy; the map is
 * returned unchanged when the room already has a way into the yard or
 * touches none of it.
 */
export function addFlap(house: HouseMap, roomId: string, pieces: readonly string[]): HouseMap {
  const room = roomById(house, roomId);
  if (room === undefined) return house;
  const joins = (d: Door) => (d.a === roomId && d.b !== null && pieces.includes(d.b)) || (d.b === roomId && pieces.includes(d.a));
  if (house.doors.some(joins)) return house;
  const polys = house.rooms.filter((r) => r.floor === room.floor).map((r) => r.poly);
  const runs = outsideRuns(house, room, polys).filter((r) => r.out !== null && pieces.includes(r.out));
  if (runs.length === 0) return house;
  // The edge facing the most yard, then its longest stretch.
  const perEdge = new Map<number, number>();
  for (const r of runs) perEdge.set(r.edge, (perEdge.get(r.edge) ?? 0) + r.hi - r.lo);
  const edge = [...perEdge.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
  const run = runs.filter((r) => r.edge === edge).sort((a, b) => b.hi - b.lo - (a.hi - a.lo))[0]!;
  const width = round(Math.min(DOOR_WIDTH, run.hi - run.lo));
  const t = round(clampGap(snap((run.lo + run.hi) / 2), width, run.lo, run.hi));
  const next = cloneData(house);
  const id = freshId(`${roomId}-flap`, next.doors.map((d) => d.id));
  next.doors.push({ id, a: roomId, b: run.out, at: pointOn(run.line, t), width });
  return next;
}

/**
 * After an indoor room was added, moved or resized (`before` = the map
 * before, without the room when it is new): every yard on its floor it
 * now overlaps is cut around it (and gets a flap if the room has no way
 * into it); a yard it used to stand in gets its old footprint back.
 */
export function settleRoom(before: HouseMap, after: HouseMap, roomId: string): HouseMap {
  const room = roomById(after, roomId);
  if (room === undefined || room.outdoor === true) return after;
  const old = roomById(before, roomId);
  let next = after;
  for (const yard of yardsOn(after, room.floor)) {
    const overlaps = yard.some((id) => polygonsOverlap(roomById(after, id)!.poly, room.poly));
    const stoodIn = old !== undefined && old.floor === room.floor && yardShare(before, roomId, yard) >= ISLAND_SHARE;
    if (!overlaps && !stoodIn) continue;
    const cut = reflowYard(next, yard, stoodIn ? [old.poly] : []);
    if (cut === next) continue;
    next = cut;
    if (overlaps) next = addFlaps(next, roomId, yardsOn(next, room.floor).find((y) => yard.some((id) => y.includes(id))) ?? yard);
  }
  return next;
}

/** Whether a room shares any of its edge with an indoor room on its floor (it is part of a house). */
export function touchesIndoor(house: HouseMap, roomId: string): boolean {
  const room = roomById(house, roomId);
  if (room === undefined) return false;
  const polys = house.rooms.filter((r) => r.floor === room.floor).map((r) => r.poly);
  return outsideRuns(house, room, polys).some((r) => r.out !== null && roomById(house, r.out)?.outdoor !== true);
}

/** A yard's pieces grouped by the openings between them: each group walks as one. */
export function yardParts(house: HouseMap, pieces: readonly string[]): string[][] {
  const parent = new Map(pieces.map((id) => [id, id]));
  const find = (id: string): string => {
    let at = id;
    while (parent.get(at) !== at) at = parent.get(at)!;
    return at;
  };
  for (const d of house.doors) {
    if (d.b === null || !parent.has(d.a) || !parent.has(d.b)) continue;
    parent.set(find(d.a), find(d.b));
  }
  const groups = new Map<string, string[]>();
  for (const id of pieces) {
    const root = find(id);
    const g = groups.get(root);
    if (g) g.push(id);
    else groups.set(root, [id]);
  }
  return [...groups.values()];
}

/**
 * The flaps a room cut into a yard needs. A free-standing room (the tent,
 * the shed — no indoor room beside it) with no way into the yard gets one,
 * on its side facing the most yard; a house room drawn over the yard does
 * not (the house has its own doors). And a part of the yard the cut sealed
 * off — no opening to the rest, no door to any room — gets one from this
 * room, or nobody could ever walk into it; the room then gets one into the
 * rest of the yard too, unless it has a way in already.
 */
function addFlaps(house: HouseMap, roomId: string, pieces: readonly string[]): HouseMap {
  let next = house;
  const joins = (h: HouseMap, part: readonly string[]) => h.doors.some((d) => (d.a === roomId && d.b !== null && part.includes(d.b)) || (d.b === roomId && part.includes(d.a)));
  if (!joins(next, pieces) && !touchesIndoor(next, roomId)) next = addFlap(next, roomId, pieces);
  const sealed = yardParts(next, pieces).filter(
    (part) =>
      !joins(next, part) &&
      !part.includes(next.spawn.room) &&
      !next.doors.some((d) => d.b !== null && part.includes(d.a) !== part.includes(d.b)) &&
      !next.stairs.some((st) => part.includes(st.from) || part.includes(st.to)),
  );
  for (const part of sealed) next = addFlap(next, roomId, part);
  if (sealed.length === 0) return next;
  // The room is now the only way into those parts: it needs a way in itself
  // (a shed drawn from the house to the fence is walked through).
  const shut = new Set(sealed.flat());
  const otherWay = next.doors.some((d) => (d.a === roomId || d.b === roomId) && d.b !== null && !shut.has(d.a) && !shut.has(d.b));
  const rest = pieces.filter((id) => !shut.has(id));
  return otherWay || rest.length === 0 ? next : addFlap(next, roomId, rest);
}

/** The flaps an edit added (doors new in `after` that the yard cut made), for the notice that says so. */
export function flapsAdded(before: HouseMap, after: HouseMap): Door[] {
  const had = new Set(before.doors.map((d) => d.id));
  return after.doors.filter((d) => !had.has(d.id) && /-flap(-\d+)?$/.test(d.id));
}

/**
 * A room was deleted (`before` still has it): a yard it stood in gets its
 * footprint back.
 */
export function giveBack(before: HouseMap, after: HouseMap, roomId: string): HouseMap {
  const room = roomById(before, roomId);
  if (room === undefined || room.outdoor === true) return after;
  let next = after;
  for (const yard of yardsOn(after, room.floor)) {
    if (yardShare(before, roomId, yard) < ISLAND_SHARE) continue;
    next = reflowYard(next, yard, [room.poly]);
  }
  return next;
}

/**
 * Whether giving a room's yard this label / LOCATION would make it the
 * same yard as another one on its floor (pieces are grouped by label +
 * LOCATION, so the two would silently merge) — refused by the inspector.
 */
export function yardClash(house: HouseMap, roomId: string, patch: Partial<Pick<Room, "label" | "location">>): boolean {
  const room = roomById(house, roomId);
  if (room === undefined || room.outdoor !== true) return false;
  const own = new Set(yardOf(house, roomId));
  const label = patch.label ?? room.label;
  const location = patch.location !== undefined ? patch.location || undefined : room.location;
  return house.rooms.some((r) => !own.has(r.id) && r.outdoor === true && r.floor === room.floor && r.label === label && r.location === location);
}

/** Set the label / LOCATION / colour of every piece of a room's yard at
 *  once (one piece relabelled alone would split off into a yard of its
 *  own). An indoor room is patched alone. Works on a copy. */
export function patchYard(house: HouseMap, roomId: string, patch: Partial<Pick<Room, "label" | "location" | "color">>): HouseMap {
  const ids = yardOf(house, roomId);
  const targets = new Set(ids.length > 0 ? ids : [roomId]);
  if (!house.rooms.some((r) => targets.has(r.id))) return house;
  const next = cloneData(house);
  for (const r of next.rooms) {
    if (!targets.has(r.id)) continue;
    Object.assign(r, patch);
    if (r.location === "" || r.location === undefined) delete r.location;
  }
  return next;
}

/** Fill a yard out to its bounding box again, cut around the rooms in it (the escape hatch). */
export function fillYard(house: HouseMap, roomId: string): HouseMap {
  const yard = yardOf(house, roomId);
  if (yard.length === 0) return house;
  const env = boundsOf(yard.map((id) => roomById(house, id)!.poly));
  return reflowYard(house, yard, [rectPoly(env)]);
}
