//! The world view's corner mini-map — pure plan maths for one floor, drawn
//! as SVG by `MiniMap.tsx`. The plan maps straight onto SVG coordinates:
//! house `x` → svg `x`, house `z` → svg `y` (z is south, svg y is down), so
//! north is up and nothing needs flipping.

import { DEFAULT_SPOT_FOV, horizontalFov, polyBounds, type DuckSpot, type HouseMap, type TerminalSpot, type Vec2 } from "@loom/house";
import { labelPoint } from "@loom/house/three";

export interface MiniRoom {
  id: string;
  label: string;
  /** SVG path data. */
  d: string;
  /** Label point. */
  x: number;
  y: number;
  outdoor: boolean;
}

export interface FloorView {
  floor: string;
  label: string;
  /** `minX minY width height`, padded. */
  viewBox: string;
  rooms: MiniRoom[];
  /** Stair rects that touch this floor. */
  stairs: Array<{ id: string; x: number; y: number; w: number; h: number }>;
}

const r = (v: number) => Math.round(v * 1000) / 1000;

/** A closed SVG path through a plan polygon. */
export function polyPath(poly: readonly Vec2[]): string {
  return poly.map(([x, z], i) => `${i === 0 ? "M" : "L"}${r(x)} ${r(z)}`).join(" ") + " Z";
}

/** Everything static on one floor's mini-map. */
export function floorView(house: HouseMap, floorId: string, pad = 0.6): FloorView {
  const floor = house.floors.find((f) => f.id === floorId) ?? house.floors[0]!;
  const rooms = house.rooms.filter((room) => room.floor === floor.id);
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const room of rooms) {
    const [a, b, c, d] = polyBounds(room.poly);
    x0 = Math.min(x0, a);
    z0 = Math.min(z0, b);
    x1 = Math.max(x1, c);
    z1 = Math.max(z1, d);
  }
  if (!Number.isFinite(x0)) [x0, z0, x1, z1] = [-1, -1, 1, 1];
  const ids = new Set(rooms.map((room) => room.id));
  return {
    floor: floor.id,
    label: floor.label,
    viewBox: `${r(x0 - pad)} ${r(z0 - pad)} ${r(x1 - x0 + 2 * pad)} ${r(z1 - z0 + 2 * pad)}`,
    rooms: rooms.map((room) => {
      const [x, y] = labelPoint(room.poly);
      return { id: room.id, label: room.label, d: polyPath(room.poly), x: r(x), y: r(y), outdoor: room.outdoor === true };
    }),
    stairs: house.stairs
      .filter((s) => ids.has(s.from) || ids.has(s.to))
      .map((s) => ({ id: s.id, x: s.rect[0], y: s.rect[1], w: r(s.rect[2] - s.rect[0]), h: r(s.rect[3] - s.rect[1]) })),
  };
}

/** The plan direction a yaw faces, as svg `[dx, dy]` (yaw 0 = north = up). */
export function planDir(yaw: number): Vec2 {
  const a = (yaw * Math.PI) / 180;
  return [-Math.sin(a), -Math.cos(a)];
}

/**
 * A terminal's view cone on the plan: a wedge `length` long, as wide as the
 * tablet sees *across*. `spot.fov` is the vertical fov (§1.1, unset =
 * `DEFAULT_SPOT_FOV`), so the wedge is its `horizontalFov` at the tablet's
 * 16:10 aspect — 70° vertical spans ≈ 96.5° on the plan.
 */
export function conePath(spot: Pick<TerminalSpot, "pos" | "yaw" | "fov">, length = 2.5): string {
  const half = horizontalFov(spot.fov ?? DEFAULT_SPOT_FOV) / 2;
  const [x, z] = [spot.pos[0], spot.pos[2]];
  const [ax, ay] = planDir(spot.yaw + half);
  const [bx, by] = planDir(spot.yaw - half);
  return `M${r(x)} ${r(z)} L${r(x + ax * length)} ${r(z + ay * length)} L${r(x + bx * length)} ${r(z + by * length)} Z`;
}

/**
 * The ducks drawn on a floor: every unfound duck whose room is on it —
 * whichever floor its player is on (a program still in the basement tent
 * has its duck upstairs).
 */
export function ducksOn<P extends { session: string; found: boolean; duck: DuckSpot }>(house: HouseMap, floor: string, players: readonly P[]): P[] {
  return players.filter((p) => !p.found && house.rooms.find((r) => r.id === p.duck.room)?.floor === floor);
}
