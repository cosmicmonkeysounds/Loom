//! The live plan's pure maths — the 2D stand-in for the world view on a
//! tablet with no WebGL2 (`PlanView.tsx`). Everything here is plain
//! `@loom/house` (never `@loom/house/three`, so three.js stays out of the
//! plan's chunk): which floor to show, how the floor fits the screen, what
//! each player's marker says, the trails, the routes to the ducks, the King.
//!
//! The plan maps straight onto the screen like the mini-map and the map
//! editor: house `x` → right, house `z` → down (z is south), so north is up.

import { floorOf, kingProps, polyBounds, roomById, route, type DuckSpot, type HouseMap, type KingState, type Vec2, type Vec3, type WallSegment } from "@loom/house";
import type { Celebration } from "../world/state.ts";

/** A player as the plan needs it (a `WorldPlayer` fits). */
export interface PlanPlayer {
  session: string;
  guest: string;
  name: string;
  floor: string;
  room: string | null;
  found: boolean;
  kept: boolean;
  duck: DuckSpot;
  avatar: string | null;
}

// --- floors ---------------------------------------------------------------------

/** The house's main floor: the one whose elevation is nearest 0. */
export function mainFloor(house: HouseMap): string {
  let best = house.floors[0]!;
  for (const f of house.floors) if (Math.abs(f.elevation) < Math.abs(best.elevation)) best = f;
  return best.id;
}

/** The floor a terminal spot hangs on, else null. */
export function spotFloor(house: HouseMap, spotId: string): string | null {
  const spot = house.terminals.find((t) => t.id === spotId);
  return spot ? (roomById(house, spot.room)?.floor ?? null) : null;
}

/** Players per floor, every floor listed (top floor first — the way a building's directory reads). */
export function floorCounts(house: HouseMap, players: Iterable<Pick<PlanPlayer, "floor">>): Array<{ id: string; label: string; count: number }> {
  const n = new Map<string, number>();
  for (const p of players) n.set(p.floor, (n.get(p.floor) ?? 0) + 1);
  return [...house.floors].sort((a, b) => b.elevation - a.elevation).map((f) => ({ id: f.id, label: f.label, count: n.get(f.id) ?? 0 }));
}

/**
 * The floor to show: the one with the most players; a tie (or nobody
 * playing) goes to this terminal's own floor when it is among the tied,
 * else the main floor when it is, else the first tied floor top-down.
 */
export function chooseFloor(house: HouseMap, players: Iterable<Pick<PlanPlayer, "floor">>, ownFloor: string | null): string {
  const counts = floorCounts(house, players);
  const top = Math.max(...counts.map((c) => c.count));
  const tied = counts.filter((c) => c.count === top).map((c) => c.id);
  if (ownFloor !== null && tied.includes(ownFloor)) return ownFloor;
  const main = mainFloor(house);
  if (tied.includes(main)) return main;
  return tied[0] ?? main;
}

/** The floor on screen, and the floor the players have wanted since `since` (ms). */
export interface FloorHold {
  shown: string | null;
  want: string | null;
  since: number;
}

/**
 * Follow the players to another floor only once they have wanted it for
 * `hold` ms straight (a program stepping onto the stairs and back doesn't
 * flip the plan); the first floor shows at once.
 */
export function holdFloor(h: FloorHold, want: string, t: number, hold: number): FloorHold {
  if (h.shown === null) return { shown: want, want, since: t };
  if (want === h.shown) return h.want === want ? h : { shown: h.shown, want, since: t };
  if (want !== h.want) return { shown: h.shown, want, since: t };
  return t - h.since >= hold ? { shown: want, want, since: t } : h;
}

// --- fitting --------------------------------------------------------------------

export type Bounds = [number, number, number, number];

/** House plan → screen: `sx = x·scale + ox`, `sy = z·scale + oy` (CSS px). */
export interface Fit {
  scale: number;
  ox: number;
  oy: number;
}

/** Fit `bounds` into a `w × h` box with `pad` px all round, centred, aspect kept. */
export function fitTransform(bounds: Bounds, w: number, h: number, pad: number): Fit {
  const [x0, z0, x1, z1] = bounds;
  const bw = Math.max(1e-6, x1 - x0);
  const bh = Math.max(1e-6, z1 - z0);
  const scale = Math.max(1e-6, Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh));
  return { scale, ox: (w - bw * scale) / 2 - x0 * scale, oy: (h - bh * scale) / 2 - z0 * scale };
}

export function toScreen(fit: Fit, x: number, z: number): Vec2 {
  return [x * fit.scale + fit.ox, z * fit.scale + fit.oy];
}

// --- one floor's static plan --------------------------------------------------

export interface PlanRoom {
  id: string;
  label: string;
  /** The story LOCATION, when it differs from the label. */
  location: string | null;
  poly: Vec2[];
  color: string;
  outdoor: boolean;
  /** Where the label goes (the bounds' centre, or the deepest grid point of an L-shaped room). */
  at: Vec2;
}

export interface PlanFloor {
  floor: string;
  label: string;
  bounds: Bounds;
  rooms: PlanRoom[];
  /** Wall lines standing on this floor (lintels over doors left out, so doors read as gaps). */
  walls: Array<{ a: Vec2; b: Vec2; kind: WallSegment["kind"] }>;
  doors: Array<{ id: string; at: Vec2; guard: string | null }>;
  stairs: Array<{ id: string; rect: [number, number, number, number]; up: boolean }>;
}

const INDOOR = "#c8c8c8";
const OUTDOOR = "#3c6e3c";

function inPoly(poly: readonly Vec2[], [x, z]: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]!;
    const [xj, zj] = poly[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function edgeDistance(poly: readonly Vec2[], [x, z]: Vec2): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j]!;
    const [bx, bz] = poly[i]!;
    const dx = bx - ax;
    const dz = bz - az;
    const len = dx * dx + dz * dz;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

/** A label point well inside a (possibly L-shaped) room. */
export function labelAt(poly: readonly Vec2[]): Vec2 {
  const [x0, z0, x1, z1] = polyBounds(poly as Vec2[]);
  let best: Vec2 = [(x0 + x1) / 2, (z0 + z1) / 2];
  let bestD = inPoly(poly, best) ? edgeDistance(poly, best) : -1;
  const n = 9;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p: Vec2 = [x0 + ((x1 - x0) * (i + 0.5)) / n, z0 + ((z1 - z0) * (j + 0.5)) / n];
      if (!inPoly(poly, p)) continue;
      const d = edgeDistance(poly, p);
      if (d > bestD + (bestD < 0 ? 0 : 0.25)) [best, bestD] = [p, d];
    }
  return best;
}

/** Everything static on one floor of the plan. */
export function planFloor(house: HouseMap, walls: readonly WallSegment[], floorId: string): PlanFloor {
  const floor = house.floors.find((f) => f.id === floorId) ?? house.floors[0]!;
  const rooms = house.rooms.filter((r) => r.floor === floor.id);
  const ids = new Set(rooms.map((r) => r.id));
  let b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rooms) {
    const [a, c, d, e] = polyBounds(r.poly);
    b = [Math.min(b[0], a), Math.min(b[1], c), Math.max(b[2], d), Math.max(b[3], e)];
  }
  if (!Number.isFinite(b[0])) b = [-1, -1, 1, 1];
  return {
    floor: floor.id,
    label: floor.label,
    bounds: b,
    rooms: rooms.map((r) => ({
      id: r.id,
      label: r.label,
      location: r.location !== undefined && r.location.trim() !== "" && r.location.toLowerCase() !== r.label.toLowerCase() ? r.location : null,
      poly: r.poly,
      color: r.color ?? (r.outdoor ? OUTDOOR : INDOOR),
      outdoor: r.outdoor === true,
      at: labelAt(r.poly),
    })),
    walls: walls
      .filter((w) => w.floor === floor.id && w.kind !== "lintel" && w.bottom <= floor.elevation + 0.5)
      .map((w) => (w.axis === "x" ? { a: [w.lo, w.c] as Vec2, b: [w.hi, w.c] as Vec2, kind: w.kind } : { a: [w.c, w.lo] as Vec2, b: [w.c, w.hi] as Vec2, kind: w.kind })),
    doors: house.doors.filter((d) => ids.has(d.a)).map((d) => ({ id: d.id, at: d.at, guard: d.guard ?? null })),
    stairs: house.stairs.filter((s) => ids.has(s.from) || ids.has(s.to)).map((s) => ({ id: s.id, rect: s.rect, up: ids.has(s.from) })),
  };
}

// --- players --------------------------------------------------------------------

/** A stable colour per guest (hue off a string hash), for a marker with no picture. */
export function guestColor(guest: string): string {
  let h = 2166136261;
  for (let i = 0; i < guest.length; i++) h = Math.imul(h ^ guest.charCodeAt(i), 16777619);
  return `hsl(${(h >>> 0) % 360}, 80%, 58%)`;
}

/** The plan direction a yaw faces, `[dx, dz]` (yaw 0 = north = up). */
export function headingOf(yaw: number): Vec2 {
  const a = (yaw * Math.PI) / 180;
  return [-Math.sin(a), -Math.cos(a)];
}

export interface Marker {
  session: string;
  name: string;
  /** Name tag text. */
  tag: string;
  color: string;
  /** `/api/avatar/<key>` URL, else null (a coloured circle). */
  picture: string | null;
  x: number;
  z: number;
  yaw: number;
  found: boolean;
  kept: boolean;
}

/** The markers on `floor`, at their interpolated poses (`sample` = `buffer.sample(t) ?? pose`). */
export function markersOn<P extends PlanPlayer>(
  players: Iterable<P>,
  floor: string,
  sample: (p: P) => { p: Vec3; yaw: number },
  picture: (key: string | null) => string | null,
): Marker[] {
  const out: Marker[] = [];
  for (const p of players) {
    if (p.floor !== floor) continue;
    const pose = sample(p);
    out.push({ session: p.session, name: p.name, tag: p.name.toUpperCase(), color: guestColor(p.guest), picture: picture(p.avatar), x: pose.p[0], z: pose.p[2], yaw: pose.yaw, found: p.found, kept: p.kept });
  }
  return out.sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : 0));
}

/** The unfound ducks whose rooms are on `floor`. */
export function ducksOnFloor<P extends PlanPlayer>(house: HouseMap, floor: string, players: Iterable<P>): P[] {
  const out: P[] = [];
  for (const p of players) if (!p.found && roomById(house, p.duck.room)?.floor === floor) out.push(p);
  return out;
}

// --- trails -----------------------------------------------------------------------

/** How long a trail point lasts (ms), and how far apart (m). */
export const TRAIL_MS = 20_000;
export const TRAIL_STEP = 0.3;
const TRAIL_MAX = 160;

export interface TrailPoint {
  x: number;
  z: number;
  floor: string;
  t: number;
}

/** Add a point to a trail if it moved `TRAIL_STEP` from the last one, dropping old ones (mutates + returns it). */
export function pushTrail(trail: TrailPoint[], pt: TrailPoint): TrailPoint[] {
  const last = trail[trail.length - 1];
  if (last === undefined || last.floor !== pt.floor || Math.hypot(pt.x - last.x, pt.z - last.z) >= TRAIL_STEP) trail.push(pt);
  let drop = 0;
  while (drop < trail.length && (pt.t - trail[drop]!.t > TRAIL_MS || trail.length - drop > TRAIL_MAX)) drop++;
  if (drop > 0) trail.splice(0, drop);
  return trail;
}

/** A trail point's opacity at `now` (1 fresh → 0 at `TRAIL_MS`). */
export function trailAlpha(pt: Pick<TrailPoint, "t">, now: number): number {
  return Math.max(0, Math.min(1, 1 - (now - pt.t) / TRAIL_MS));
}

// --- routes -------------------------------------------------------------------------

/** The golden route from a player's feet to their duck (empty when it can't be found). */
export function duckRoute(house: HouseMap, from: Vec3, duck: DuckSpot, fallen: ReadonlySet<string>): Vec3[] {
  try {
    return route(house, from, duck.pos, fallen.size > 0 ? { fallen } : {});
  } catch {
    return [];
  }
}

/** The route's legs that lie on `floor` (a leg counts when either end is on it). */
export function legsOn(house: HouseMap, path: readonly Vec3[], floor: string): Array<[Vec3, Vec3]> {
  const out: Array<[Vec3, Vec3]> = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    if (floorOf(house, a[1]) === floor || floorOf(house, b[1]) === floor) out.push([a, b]);
  }
  return out;
}

// --- the King -----------------------------------------------------------------------

export interface PlanKing {
  id: string;
  x: number;
  z: number;
  hp: number;
  max: number;
  fallen: boolean;
}

/** The King on `floor`, with the shared bar (`state`; null when the server shares none: drawn without one). */
export function kingOnFloor(house: HouseMap, floor: string, state: KingState | null): PlanKing | null {
  for (const k of kingProps(house)) {
    if (roomById(house, k.room)?.floor !== floor) continue;
    const s = state !== null && state.id === k.id ? state : null;
    const max = s?.max ?? Math.max(1, k.hp ?? 4);
    const hp = s?.hp ?? max;
    return { id: k.id, x: k.pos[0], z: k.pos[2], hp, max, fallen: s?.fallen ?? false };
  }
  return null;
}

// --- words ----------------------------------------------------------------------------

/** The status line. */
export function statusLine(players: number, connected: boolean): string {
  if (!connected) return "OFFLINE · RECONNECTING…";
  return `LIVE · ${players} ${players === 1 ? "PLAYER" : "PLAYERS"}`;
}

/** The big banner for a find. */
export function celebrationHeadline(c: Pick<Celebration, "name" | "released" | "kept">): string {
  const name = c.name.toUpperCase();
  if (c.kept) return `${name} · GERALD CAN'T HELP`;
  return c.released ? `REINSTALLED: ${name}` : `${name} FOUND THE GOLDEN DUCK`;
}

/**
 * Whether a roster change is a person's join / leave worth a toast, rather
 * than the whole roster swapped: the `hello` that follows a (re)connect, the
 * players dropped while the stream is down, or a story reset.
 */
export function rosterTellsToasts(o: { awaitingHello: boolean; connected: boolean; resetChanged: boolean }): boolean {
  return !o.awaitingHello && o.connected && !o.resetChanged;
}

/** Who joined / left between two rosters (a found player's leave is the celebration's, not a toast). */
export function rosterToasts(prev: ReadonlyMap<string, Pick<PlanPlayer, "name" | "found">>, next: ReadonlyMap<string, Pick<PlanPlayer, "name" | "found">>): string[] {
  const out: string[] = [];
  for (const [id, p] of next) if (!prev.has(id)) out.push(`${p.name.toUpperCase()} ENTERED THE SIMULATION`);
  for (const [id, p] of prev) if (!next.has(id) && !p.found) out.push(`${p.name.toUpperCase()} LEFT THE SIMULATION`);
  return out;
}
