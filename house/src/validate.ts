//! `validateHouse` — every refusal in `docs/loom-reinstall.md` §1.1 — and
//! `normalizeHouse` (defaults filled). Two phases: shapes and types first
//! (a map with a wrong shape can't be measured), then references and
//! geometry. Room `location` names are not checked here (no model); the
//! server warns about those.

import { cloneData } from "./clone.ts";
import { DUCK_MAX_RISE } from "./duck.ts";
import { IDENTITY_SPACE } from "./frames.ts";
import {
  DEFAULT_DOOR_HEIGHT,
  DEFAULT_FENCE,
  DEFAULT_WALL_THICKNESS,
  DOOR_TOLERANCE,
  breakpoints,
  distanceToBoundary,
  mmi,
  onDoorLine,
  pointInPoly,
  pointInPolyStrict,
  polyBounds,
  rectPoly,
  styleOf,
} from "./geometry.ts";
import { BODY_CLEAR, FLOOR_SLACK, STEP_UP, floorOf, locate, solidPropAt } from "./locate.ts";
import type { HouseMap, Room, SpaceTransform, TerminalViewName, Validation, Vec2, Vec3 } from "./types.ts";

/** Every screen type a terminal spot may name (`TerminalSpot.view`) — the
 *  `terminal` app's `VIEWS` is this list. */
export const TERMINAL_VIEWS: readonly TerminalViewName[] = ["auto", "world", "face", "mirror", "tv", "chess", "shadow", "casino", "reinstall"];

/** How far outside its room a terminal / duck spot / spawn / prop may sit. */
export const SPOT_TOLERANCE = 0.05;
/** The clear floor a stair needs beyond its head (in `to`) and its foot (in `from`), in metres. */
export const STAIR_CLEARANCE = 0.3;
/** How tall a duck is, for the solid-prop check (a player: `BODY_CLEAR`). */
const DUCK_CLEAR = 0.5;

const PROP_KINDS = ["box", "cylinder", "screen", "label", "king"];
/** The fields only a `king` prop may carry. */
const KING_FIELDS = ["hp", "health", "signals", "armed"] as const;
const SIGNAL_KEYS = ["won", "lost", "drawn", "hit", "fallen"];
/** A king's largest `hp` (one shared bar for the night: 15 at the show). */
export const KING_MAX_HP = 99;
/** A world path: identifiers joined by dots (`Night.king_hp`). */
const WORLD_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
/** A guard further than this (plan metres) from its door's point is warned about (`guardWarnings`). */
export const GUARD_REACH = 1.0;
const COMPASS = ["n", "s", "e", "w"];
const COLOR = /^#[0-9a-fA-F]{6}$/;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isVec = (v: unknown, n: number): boolean => Array.isArray(v) && v.length === n && v.every(isNum);
const fmt = (p: readonly number[]): string => `[${p.join(", ")}]`;

/**
 * Validate a raw (parsed JSON) house map. `ok` ⇔ no problems; then `house`
 * is the normalized map (`normalizeHouse`).
 */
export function validateHouse(raw: unknown): Validation {
  const problems: string[] = [];
  checkShape(raw, problems);
  if (problems.length > 0) return { ok: false, problems };
  const house = normalizeHouse(raw as HouseMap);
  checkGeometry(house, problems);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, problems, house };
}

/**
 * A copy with every default filled: `doors` / `stairs` / `terminals` /
 * `props` `[]`, `spaces.vr` + `spaces.web` (and any partial space) the
 * identity, `style` complete. Tolerates those keys missing at runtime.
 */
export function normalizeHouse(house: HouseMap): HouseMap {
  const h = cloneData(house);
  h.doors ??= [];
  h.stairs ??= [];
  h.terminals ??= [];
  h.props ??= [];
  h.origin ??= "";
  const spaces: Record<string, SpaceTransform> = {};
  const given = (h.spaces ?? {}) as Record<string, Partial<SpaceTransform>>;
  for (const name of ["vr", "web", ...Object.keys(given)]) {
    const s = given[name] ?? {};
    spaces[name] = {
      offset: s.offset ? [...s.offset] : [...IDENTITY_SPACE.offset],
      yaw: s.yaw ?? IDENTITY_SPACE.yaw,
      scale: s.scale ?? IDENTITY_SPACE.scale,
    };
  }
  h.spaces = spaces;
  h.style = {
    fence: h.style?.fence ?? DEFAULT_FENCE,
    wallThickness: h.style?.wallThickness ?? DEFAULT_WALL_THICKNESS,
    doorHeight: h.style?.doorHeight ?? DEFAULT_DOOR_HEIGHT,
  };
  return h;
}

// ── Phase 1: shapes, types, finite numbers, duplicate ids ────────────

function label(kind: string, i: number, item: unknown): string {
  const id = isObj(item) && isStr(item["id"]) ? ` "${item["id"]}"` : "";
  return `${kind}[${i}]${id}`;
}

function checkShape(raw: unknown, problems: string[]): void {
  if (!isObj(raw)) {
    problems.push("house map must be an object");
    return;
  }
  if (raw["version"] !== 1) problems.push(`version must be 1 (got ${JSON.stringify(raw["version"])})`);
  if (!isStr(raw["name"])) problems.push("name must be a string");
  if (raw["origin"] !== undefined && !isStr(raw["origin"])) problems.push("origin must be a string");
  if (raw["variant"] !== undefined && !isStr(raw["variant"])) problems.push("variant must be a string");

  const list = (key: string, required: boolean, min: number): unknown[] => {
    const v = raw[key];
    if (v === undefined && !required) return [];
    if (!Array.isArray(v)) {
      problems.push(`${key} must be an array`);
      return [];
    }
    if (v.length < min) problems.push(`${key} needs at least ${min}`);
    return v;
  };

  const ids = (kind: string, items: unknown[]): void => {
    const seen = new Set<string>();
    for (const item of items) {
      if (!isObj(item) || !isId(item["id"])) continue;
      if (seen.has(item["id"])) problems.push(`duplicate ${kind} id "${item["id"]}"`);
      seen.add(item["id"]);
    }
  };

  // Each field check: [key, test, what it must be, optional].
  type Field = [string, (v: unknown) => boolean, string, boolean?];
  const fields = (kind: string, items: unknown[], spec: Field[]): void => {
    items.forEach((item, i) => {
      const at = label(kind, i, item);
      if (!isObj(item)) {
        problems.push(`${at} must be an object`);
        return;
      }
      for (const [key, test, what, optional] of spec) {
        const v = item[key];
        if (v === undefined && optional) continue;
        if (!test(v)) problems.push(`${at}: ${key} must be ${what}`);
      }
    });
  };

  const positive = (v: unknown): boolean => isNum(v) && v > 0;
  const vec2 = (v: unknown): boolean => isVec(v, 2);
  const vec3 = (v: unknown): boolean => isVec(v, 3);
  const ID = "a non-empty string";
  const NUM = "a finite number";
  const POS = "a finite number > 0";
  const V3 = "[x, y, z] (finite numbers)";

  const floors = list("floors", true, 1);
  fields("floors", floors, [
    ["id", isId, ID],
    ["label", isStr, "a string"],
    ["elevation", isNum, NUM],
    ["height", positive, POS],
  ]);
  ids("floor", floors);

  const rooms = list("rooms", true, 1);
  fields("rooms", rooms, [
    ["id", isId, ID],
    ["label", isStr, "a string"],
    ["floor", isId, ID],
    ["location", isStr, "a string", true],
    ["poly", (v) => Array.isArray(v) && v.every(vec2), "an array of [x, z] (finite numbers)"],
    ["height", positive, POS, true],
    ["outdoor", (v) => typeof v === "boolean", "a boolean", true],
    ["color", (v) => isStr(v) && COLOR.test(v), '"#rrggbb"', true],
  ]);
  ids("room", rooms);

  const doors = list("doors", false, 0);
  fields("doors", doors, [
    ["id", isId, ID],
    ["a", isId, ID],
    ["b", (v) => v === null || isId(v), "a room id or null"],
    ["at", vec2, "[x, z] (finite numbers)"],
    ["width", positive, POS],
    ["height", positive, POS, true],
    ["guard", isId, ID, true],
  ]);
  ids("door", doors);

  const stairs = list("stairs", false, 0);
  fields("stairs", stairs, [
    ["id", isId, ID],
    ["from", isId, ID],
    ["to", isId, ID],
    ["rect", (v) => isVec(v, 4), "[x0, z0, x1, z1] (finite numbers)"],
    ["up", (v) => isStr(v) && COMPASS.includes(v), '"n", "s", "e" or "w"'],
  ]);
  ids("stair", stairs);

  const terminals = list("terminals", false, 0);
  fields("terminals", terminals, [
    ["id", isId, ID],
    ["name", isStr, "a string"],
    ["room", isId, ID],
    ["pos", vec3, V3],
    ["yaw", isNum, NUM],
    ["pitch", isNum, NUM, true],
    ["fov", positive, POS, true],
    ["view", (v) => typeof v === "string" && (TERMINAL_VIEWS as readonly string[]).includes(v), `one of ${TERMINAL_VIEWS.join(", ")}`, true],
    ["speaks", (v) => typeof v === "boolean", "a boolean", true],
    ["voice", (v) => typeof v === "boolean", "a boolean", true],
  ]);
  ids("terminal", terminals);

  const duck = raw["duck"];
  if (!isObj(duck)) problems.push("duck must be an object with spots");
  else {
    const spots = Array.isArray(duck["spots"]) ? duck["spots"] : [];
    if (!Array.isArray(duck["spots"])) problems.push("duck.spots must be an array");
    else if (spots.length < 1) problems.push("duck.spots needs at least 1");
    fields("duck.spots", spots, [
      ["id", isId, ID],
      ["room", isId, ID],
      ["pos", vec3, V3],
    ]);
    ids("duck spot", spots);
  }

  const spawn = raw["spawn"];
  if (!isObj(spawn)) problems.push("spawn must be an object");
  else fields("spawn", [spawn], [
    ["room", isId, ID],
    ["pos", vec3, V3],
    ["yaw", isNum, NUM],
  ]);

  const props = list("props", false, 0);
  fields("props", props, [
    ["id", isId, ID],
    ["room", isId, ID],
    ["kind", (v) => isStr(v) && PROP_KINDS.includes(v), PROP_KINDS.map((k) => `"${k}"`).join(" | ")],
    ["pos", vec3, V3],
    ["size", (v) => isVec(v, 3) && (v as number[]).every((n) => n >= 0), "[w, h, d] (finite numbers ≥ 0)"],
    ["yaw", isNum, NUM, true],
    ["color", (v) => isStr(v) && COLOR.test(v), '"#rrggbb"', true],
    ["label", isStr, "a string", true],
    ["solid", (v) => typeof v === "boolean", "a boolean", true],
    ["hp", (v) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= KING_MAX_HP, `an integer 1–${KING_MAX_HP}`, true],
    ["health", (v) => isStr(v) && WORLD_PATH.test(v), 'a world path ("Night.king_hp")', true],
    [
      "signals",
      (v) => isObj(v) && Object.entries(v).every(([k, s]) => SIGNAL_KEYS.includes(k) && isStr(s) && s.trim() !== ""),
      "{won?, lost?, drawn?, hit?, fallen?} of non-empty strings",
      true,
    ],
    ["armed", (v) => isObj(v) && isStr(v["path"]) && v["path"] !== "" && isNum(v["min"]), "{path, min}", true],
  ]);
  ids("prop", props);
  // `hp` / `health` / `signals` / `armed` mean nothing on anything but a king.
  props.forEach((item, i) => {
    if (!isObj(item) || item["kind"] === "king") return;
    for (const key of KING_FIELDS) {
      if (item[key] !== undefined) problems.push(`${label("props", i, item)}: "${key}" is only for kind "king"`);
    }
  });

  const spaces = raw["spaces"];
  if (spaces !== undefined) {
    if (!isObj(spaces)) problems.push("spaces must be an object");
    else
      for (const [name, s] of Object.entries(spaces)) {
        if (!isObj(s)) {
          problems.push(`spaces.${name} must be an object`);
          continue;
        }
        if (s["offset"] !== undefined && !vec3(s["offset"])) problems.push(`spaces.${name}: offset must be ${V3}`);
        if (s["yaw"] !== undefined && !isNum(s["yaw"])) problems.push(`spaces.${name}: yaw must be ${NUM}`);
        if (s["scale"] !== undefined && !positive(s["scale"])) problems.push(`spaces.${name}: scale must be ${POS}`);
      }
  }

  const style = raw["style"];
  if (style !== undefined) {
    if (!isObj(style)) problems.push("style must be an object");
    else
      for (const key of ["fence", "wallThickness", "doorHeight"]) {
        if (style[key] !== undefined && !positive(style[key])) problems.push(`style.${key} must be ${POS}`);
      }
  }
}

// ── Phase 2: references + geometry ───────────────────────────────────

/** A polygon's problems: fewer than 4 distinct points, a diagonal edge, a self-intersection. */
export function polygonProblems(poly: Vec2[]): string[] {
  // Work in millimetres, consecutive duplicates dropped.
  const pts: [number, number][] = [];
  for (const p of poly) {
    const q: [number, number] = [mmi(p[0]), mmi(p[1])];
    const last = pts[pts.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) pts.push(q);
  }
  while (pts.length > 1 && pts[0]![0] === pts[pts.length - 1]![0] && pts[0]![1] === pts[pts.length - 1]![1]) pts.pop();
  const n = pts.length;
  if (n < 4) return [`needs at least 4 distinct points (has ${n})`];
  const edges = pts.map((p, i) => [p, pts[(i + 1) % n]!] as const);
  const out: string[] = [];
  edges.forEach(([p, q], i) => {
    if (p[0] !== q[0] && p[1] !== q[1]) {
      out.push(`is not rectilinear (edge ${i} ${fmt([p[0] / 1000, p[1] / 1000])} → ${fmt([q[0] / 1000, q[1] / 1000])} is diagonal)`);
    }
  });
  if (out.length > 0) return out;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const [a0, a1] = edges[i]!;
      const [b0, b1] = edges[j]!;
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Collinear and doubling back = a spike.
        const dax = Math.sign(a1[0] - a0[0]);
        const daz = Math.sign(a1[1] - a0[1]);
        const dbx = Math.sign(b1[0] - b0[0]);
        const dbz = Math.sign(b1[1] - b0[1]);
        if (dax === -dbx && daz === -dbz) return [`is self-intersecting (edges ${i} and ${j} double back)`];
        continue;
      }
      const ax0 = Math.min(a0[0], a1[0]);
      const ax1 = Math.max(a0[0], a1[0]);
      const az0 = Math.min(a0[1], a1[1]);
      const az1 = Math.max(a0[1], a1[1]);
      const bx0 = Math.min(b0[0], b1[0]);
      const bx1 = Math.max(b0[0], b1[0]);
      const bz0 = Math.min(b0[1], b1[1]);
      const bz1 = Math.max(b0[1], b1[1]);
      if (ax0 <= bx1 && bx0 <= ax1 && az0 <= bz1 && bz0 <= az1) {
        return [`is self-intersecting (edges ${i} and ${j} touch)`];
      }
    }
  }
  return [];
}

/** Whether two polygons share positive area (> 1 mm cells). */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  const ba = polyBounds(a);
  const bb = polyBounds(b);
  const x0 = Math.max(ba[0], bb[0]);
  const z0 = Math.max(ba[1], bb[1]);
  const x1 = Math.min(ba[2], bb[2]);
  const z1 = Math.min(ba[3], bb[3]);
  if (mmi(x1) <= mmi(x0) || mmi(z1) <= mmi(z0)) return false;
  const xs = breakpoints([...a, ...b].map((p) => p[0])).filter((x) => x >= x0 - 1e-9 && x <= x1 + 1e-9);
  const zs = breakpoints([...a, ...b].map((p) => p[1])).filter((z) => z >= z0 - 1e-9 && z <= z1 + 1e-9);
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const c: Vec2 = [(xs[i]! + xs[i + 1]!) / 2, (zs[j]! + zs[j + 1]!) / 2];
      if (pointInPolyStrict(a, c) && pointInPolyStrict(b, c)) return true;
    }
  }
  return false;
}

/** Whether the rect `[x0, z0, x1, z1]` lies inside the polygon (boundary counts, 1 mm). */
export function rectInsidePoly(poly: Vec2[], rect: readonly [number, number, number, number]): boolean {
  const [x0, z0, x1, z1] = rect;
  const xs = breakpoints([x0, x1, ...poly.map((p) => p[0])]).filter((x) => mmi(x) >= mmi(x0) && mmi(x) <= mmi(x1));
  const zs = breakpoints([z0, z1, ...poly.map((p) => p[1])]).filter((z) => mmi(z) >= mmi(z0) && mmi(z) <= mmi(z1));
  // A rect under 1 mm on an axis has no cells to test: not inside anything.
  if (xs.length < 2 || zs.length < 2) return false;
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < zs.length; j++) {
      const c: Vec2 = [(xs[i]! + xs[i + 1]!) / 2, (zs[j]! + zs[j + 1]!) / 2];
      if (!pointInPolyStrict(poly, c)) return false;
    }
  }
  return true;
}

/** Whether a plan point is in a room's footprint, ± 0.05 m. */
export function nearFootprint(room: Room, p: Vec2, tolerance = SPOT_TOLERANCE): boolean {
  return pointInPoly(room.poly, p) || distanceToBoundary(room.poly, p) <= tolerance + 1e-9;
}

/** Whether two polygons share positive area or touch (a vertex of one within 1 mm of the other's boundary). */
export function polygonsMeet(a: Vec2[], b: Vec2[]): boolean {
  if (polygonsOverlap(a, b)) return true;
  const near = (poly: Vec2[], p: Vec2): boolean => distanceToBoundary(poly, p) <= 0.001 + 1e-9;
  return a.some((p) => near(b, p)) || b.some((p) => near(a, p));
}

/** The `depth`-deep strip just beyond a rect's `side` edge, as a rect. */
function stripBeyond(rect: readonly [number, number, number, number], side: string, depth: number): [number, number, number, number] {
  const [x0, z0, x1, z1] = rect;
  if (side === "n") return [x0, z0 - depth, x1, z0];
  if (side === "s") return [x0, z1, x1, z1 + depth];
  if (side === "e") return [x1, z0, x1 + depth, z1];
  return [x0 - depth, z0, x0, z1];
}

const OPPOSITE: Record<string, string> = { n: "s", s: "n", e: "w", w: "e" };

/**
 * The merged runs `[lo, hi]` (mm) of a room's own walls on the line
 * `axis` at `coord` (± 0.02 m).
 */
function wallRuns(room: Room, axis: "x" | "z", coord: number): [number, number][] {
  const runs: [number, number][] = [];
  const n = room.poly.length;
  for (let i = 0; i < n; i++) {
    const p = room.poly[i]!;
    const q = room.poly[(i + 1) % n]!;
    // "x": the wall runs along x at z = coord.
    const pAlong = axis === "x" ? p[0] : p[1];
    const qAlong = axis === "x" ? q[0] : q[1];
    const pAcross = axis === "x" ? p[1] : p[0];
    const qAcross = axis === "x" ? q[1] : q[0];
    if (mmi(pAcross) !== mmi(qAcross)) continue;
    if (mmi(pAlong) === mmi(qAlong)) continue;
    // The same line test as `buildWalls` step 5: the wall's mm-rounded line.
    if (!onDoorLine(mmi(pAcross), coord)) continue;
    runs.push([Math.min(mmi(pAlong), mmi(qAlong)), Math.max(mmi(pAlong), mmi(qAlong))]);
  }
  runs.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

function checkGeometry(house: HouseMap, problems: string[]): void {
  const floors = new Map(house.floors.map((f) => [f.id, f]));
  const rooms = new Map(house.rooms.map((r) => [r.id, r]));
  const goodPoly = new Set<string>();

  // `floorOf` takes the highest floor within FLOOR_SLACK below a point, so
  // two floors that close would hide the lower one from `locate`.
  const byElevation = [...house.floors].sort((a, b) => a.elevation - b.elevation);
  for (let i = 0; i + 1 < byElevation.length; i++) {
    const lo = byElevation[i]!;
    const hi = byElevation[i + 1]!;
    if (mmi(hi.elevation) - mmi(lo.elevation) <= mmi(FLOOR_SLACK)) {
      problems.push(
        `floors "${lo.id}" and "${hi.id}": elevations must differ by more than ${FLOOR_SLACK} m (a point on the lower floor would locate on the upper)`,
      );
    }
  }

  house.rooms.forEach((room, i) => {
    const at = label("rooms", i, room);
    if (!floors.has(room.floor)) problems.push(`${at}: unknown floor "${room.floor}"`);
    const bad = polygonProblems(room.poly);
    for (const b of bad) problems.push(`${at}: polygon ${b}`);
    if (bad.length === 0) goodPoly.add(room.id);
  });

  for (let i = 0; i < house.rooms.length; i++) {
    for (let j = i + 1; j < house.rooms.length; j++) {
      const a = house.rooms[i]!;
      const b = house.rooms[j]!;
      if (a.floor !== b.floor || !goodPoly.has(a.id) || !goodPoly.has(b.id)) continue;
      if (polygonsOverlap(a.poly, b.poly)) problems.push(`rooms "${a.id}" and "${b.id}" overlap on floor "${a.floor}"`);
    }
  }

  // Vertical clearance: a room's walls (top as `buildWalls` makes it) must
  // not rise through a higher floor where that floor's rooms are above or
  // beside them — the games collide with every wall whatever its floor.
  const style = styleOf(house);
  house.rooms.forEach((room, i) => {
    const floor = floors.get(room.floor);
    if (!floor || !goodPoly.has(room.id)) return;
    const top = mmi(floor.elevation + (room.outdoor ? style.fence : (room.height ?? floor.height)));
    for (const upper of house.floors) {
      const e = mmi(upper.elevation);
      if (e <= mmi(floor.elevation) || e >= top) continue;
      const over = house.rooms.find((r) => r.floor === upper.id && goodPoly.has(r.id) && polygonsMeet(room.poly, r.poly));
      if (over) {
        problems.push(
          `${label("rooms", i, room)}: its top (${top / 1000} m) rises above floor "${upper.id}" (elevation ${upper.elevation}) under room "${over.id}"`,
        );
      }
    }
  });

  const cuts: { id: string; floor: string; axis: "x" | "z"; c: number; lo: number; hi: number }[] = [];

  house.doors.forEach((door, i) => {
    const at = label("doors", i, door);
    const a = rooms.get(door.a);
    const b = door.b === null ? null : rooms.get(door.b);
    if (!a) problems.push(`${at}: unknown room "${door.a}"`);
    if (door.b !== null && !b) problems.push(`${at}: unknown room "${door.b}"`);
    if (!a || (door.b !== null && !b)) return;
    if (b && b.id === a.id) {
      problems.push(`${at}: joins room "${a.id}" to itself`);
      return;
    }
    if (b && b.floor !== a.floor) {
      problems.push(`${at}: rooms "${a.id}" and "${b.id}" are on different floors`);
      return;
    }
    const half = door.width / 2;
    let onA = false;
    for (const axis of ["x", "z"] as const) {
      const coord = axis === "x" ? door.at[1] : door.at[0];
      const t = axis === "x" ? door.at[0] : door.at[1];
      const tm = mmi(t);
      const runA = wallRuns(a, axis, coord).find((r) => r[0] <= tm && tm <= r[1]);
      if (!runA) continue;
      onA = true;
      const runB = b ? wallRuns(b, axis, coord).find((r) => r[0] <= tm && tm <= r[1]) : undefined;
      if (b && !runB) continue;
      const lo = mmi(t - half);
      const hi = mmi(t + half);
      for (const [room, run] of [
        [a, runA],
        [b, runB],
      ] as const) {
        if (room && run && (lo < run[0] || hi > run[1])) {
          problems.push(`${at}: its ${door.width} m gap runs past the wall of room "${room.id}"`);
        }
      }
      if (!b) {
        // To the outside: no other room on the floor may have a wall there,
        // or the door opens a passage `route` doesn't know about (and
        // `buildWalls` may cut that room's wall instead).
        for (const r of house.rooms) {
          if (r.id === a.id || r.floor !== a.floor || !goodPoly.has(r.id)) continue;
          if (wallRuns(r, axis, coord).some(([u, v]) => Math.min(hi, v) - Math.max(lo, u) > 0)) {
            problems.push(`${at}: a door to the outside (b = null) sits on a wall shared with room "${r.id}" — name it as b`);
          }
        }
      }
      // Doors on one wall line (buildWalls snaps within the tolerance) must not share gap.
      const c = coord * 1000;
      for (const o of cuts) {
        if (o.floor !== a.floor || o.axis !== axis || Math.abs(o.c - c) > 2 * DOOR_TOLERANCE * 1000 + 1e-6) continue;
        if (lo < o.hi && o.lo < hi) problems.push(`${at}: its gap overlaps door "${o.id}"`);
      }
      cuts.push({ id: door.id, floor: a.floor, axis, c, lo, hi });
      return;
    }
    if (!onA) problems.push(`${at}: ${fmt(door.at)} is not on a wall of room "${a.id}" (± ${DOOR_TOLERANCE} m)`);
    else problems.push(`${at}: ${fmt(door.at)} is not on a wall room "${a.id}" shares with "${b?.id}"`);
  });

  // A guarded door: its guard is a king prop standing in one of its rooms.
  house.doors.forEach((door, i) => {
    if (door.guard === undefined) return;
    const at = label("doors", i, door);
    const king = house.props.find((p) => p.id === door.guard);
    if (!king) {
      problems.push(`${at}: guard names unknown prop "${door.guard}"`);
      return;
    }
    if (king.kind !== "king") {
      problems.push(`${at}: guard "${king.id}" is a "${king.kind}", not a king`);
      return;
    }
    if (king.room !== door.a && king.room !== door.b) {
      problems.push(`${at}: guard "${king.id}" stands in room "${king.room}", not beside door "${door.id}"`);
    }
  });

  house.stairs.forEach((stair, i) => {
    const at = label("stairs", i, stair);
    const from = rooms.get(stair.from);
    const to = rooms.get(stair.to);
    if (!from) problems.push(`${at}: unknown room "${stair.from}"`);
    if (!to) problems.push(`${at}: unknown room "${stair.to}"`);
    if (!from || !to) return;
    const [x0, z0, x1, z1] = stair.rect;
    if (!(mmi(x0) < mmi(x1) && mmi(z0) < mmi(z1))) {
      problems.push(`${at}: rect needs x0 < x1 and z0 < z1 by at least 1 mm`);
      return;
    }
    const ef = floors.get(from.floor);
    const et = floors.get(to.floor);
    if (from.floor === to.floor) problems.push(`${at}: rooms "${from.id}" and "${to.id}" are on the same floor`);
    else if (ef && et && !(ef.elevation < et.elevation)) {
      problems.push(`${at}: from "${from.id}" must be on a lower floor than to "${to.id}"`);
    }
    for (const [room, end, side] of [
      [from, "foot", OPPOSITE[stair.up]!],
      [to, "head", stair.up],
    ] as const) {
      if (!goodPoly.has(room.id)) continue;
      if (!rectInsidePoly(room.poly, stair.rect)) {
        problems.push(`${at}: rect ${fmt(stair.rect)} is not inside room "${room.id}"`);
      } else if (!rectInsidePoly(room.poly, stripBeyond(stair.rect, side, STAIR_CLEARANCE))) {
        problems.push(`${at}: its ${end} (the "${side}" edge) needs ${STAIR_CLEARANCE} m of room "${room.id}" beyond it`);
      }
    }
    // A stair can't pass through a floor between its two: that floor gets no hole and no rails.
    if (ef && et) {
      for (const mid of house.floors) {
        if (!(mmi(mid.elevation) > mmi(ef.elevation) && mmi(mid.elevation) < mmi(et.elevation))) continue;
        const hit = house.rooms.find(
          (r) => r.floor === mid.id && goodPoly.has(r.id) && polygonsOverlap(r.poly, rectPoly(stair.rect)),
        );
        if (hit) problems.push(`${at}: it passes through floor "${mid.id}" (room "${hit.id}"), which has no hole for it`);
      }
    }
  });

  // A stairwell stacked flight over flight (the upper one's rect over the
  // lower one's, in plan) can't be walked: the lower flight's hole and its
  // rails sit right where the upper one starts. Offset them in plan; the
  // virtual house only has to read like the real one.
  const floorOfRoom = (id: string): string | undefined => rooms.get(id)?.floor;
  house.stairs.forEach((a, i) => {
    for (let j = i + 1; j < house.stairs.length; j++) {
      const b = house.stairs[j]!;
      const fa = [floorOfRoom(a.from), floorOfRoom(a.to)];
      const fb = [floorOfRoom(b.from), floorOfRoom(b.to)];
      if (!fa.some((f) => f !== undefined && fb.includes(f))) continue;
      const [ax0, az0, ax1, az1] = a.rect.map(mmi) as [number, number, number, number];
      const [bx0, bz0, bx1, bz1] = b.rect.map(mmi) as [number, number, number, number];
      if (ax0 < bx1 && bx0 < ax1 && az0 < bz1 && bz0 < az1) {
        problems.push(`${label("stairs", i, a)}: its rect overlaps stair "${b.id}" in plan (a stacked stairwell can't be walked; offset the flights)`);
      }
    }
  });

  const placed = (kind: "terminal" | "duck" | "spawn" | "prop", at: string, roomId: string, pos: readonly number[]): void => {
    const room = rooms.get(roomId);
    if (!room) {
      problems.push(`${at}: unknown room "${roomId}"`);
      return;
    }
    if (!goodPoly.has(room.id)) return;
    if (!nearFootprint(room, [pos[0]!, pos[2]!])) {
      problems.push(`${at}: ${fmt(pos)} is outside room "${room.id}" (± ${SPOT_TOLERANCE} m)`);
      return;
    }
    const floor = floors.get(room.floor);
    if (!floor) return;
    const y = pos[1]!;
    const dy = y - floor.elevation;
    const where = `room "${room.id}"'s floor (elevation ${floor.elevation})`;
    if (kind === "terminal" || kind === "prop") {
      // Anywhere in the room's own storey.
      const h = room.height ?? floor.height;
      if (dy < -SPOT_TOLERANCE - 1e-9 || dy > h + 1e-9) {
        problems.push(`${at}: y ${y} is not within room "${room.id}"'s height (${floor.elevation} to ${mm3(floor.elevation + h)} m)`);
      }
      return;
    }
    // A duck spot or the spawn is located like a player: same floor, same room.
    const on = floorOf(house, y);
    if (on !== room.floor) {
      problems.push(`${at}: y ${y} is on floor "${on}", not room "${room.id}"'s floor "${room.floor}"`);
      return;
    }
    if (kind === "duck" && (dy < -SPOT_TOLERANCE - 1e-9 || dy > DUCK_MAX_RISE + 1e-9)) {
      problems.push(`${at}: y ${y} must be 0 to ${DUCK_MAX_RISE} m above ${where}`);
      return;
    }
    if (kind === "spawn" && Math.abs(dy) > STEP_UP + 1e-9) {
      problems.push(`${at}: y ${y} must be within ${STEP_UP} m of ${where}`);
      return;
    }
    const plan: Vec2 = [pos[0]!, pos[2]!];
    if (pointInPolyStrict(room.poly, plan) && distanceToBoundary(room.poly, plan) > 1e-6) {
      const got = locate(house, pos as Vec3).room;
      if (got !== room.id) problems.push(`${at}: ${fmt(pos)} locates to room "${got}", not "${room.id}"`);
    }
    // Not buried in a solid prop (resting on its top is fine).
    const clear = kind === "duck" ? DUCK_CLEAR : BODY_CLEAR;
    const prop = solidPropAt(house, [plan[0], y, plan[1]], clear);
    if (prop) {
      problems.push(`${at}: ${fmt(pos)} is inside solid prop "${prop.id}" (rest it on top at y ${mm3(prop.pos[1] + prop.size[1])} or move it clear)`);
    }
  };
  house.terminals.forEach((t, i) => placed("terminal", label("terminals", i, t), t.room, t.pos));
  house.duck.spots.forEach((s, i) => placed("duck", label("duck.spots", i, s), s.room, s.pos));
  placed("spawn", "spawn", house.spawn.room, house.spawn.pos);
  house.props.forEach((p, i) => placed("prop", label("props", i, p), p.room, p.pos));
}

/**
 * Advice, not refusals, about guarded doors on a valid map (the server
 * folds these into its map warnings; the map page lists them): a king
 * whose base centre stands more than `GUARD_REACH` (plan) from the door
 * it guards — he would not be in the doorway at all.
 */
export function guardWarnings(house: HouseMap): string[] {
  const out: string[] = [];
  for (const door of house.doors) {
    if (door.guard === undefined) continue;
    const king = house.props.find((p) => p.id === door.guard);
    if (!king || king.kind !== "king") continue;
    const d = Math.hypot(king.pos[0] - door.at[0], king.pos[2] - door.at[1]);
    if (d > GUARD_REACH + 1e-9) {
      out.push(`door "${door.id}": its guard "${king.id}" stands ${mm3(d)} m from the door (more than ${GUARD_REACH} m) — he is not in the doorway`);
    }
  }
  return out;
}

/** Round for a message (1 mm, no float noise). */
function mm3(v: number): number {
  return mmi(v) / 1000 + 0;
}
