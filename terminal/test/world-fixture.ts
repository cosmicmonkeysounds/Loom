//! A tiny house for the world-view tests: two 4×4 rooms side by side on one
//! floor, a door between them, a terminal on room A's west wall facing in.

import { buildWalls, validateHouse, type HouseMap, type PlayerState, type Vec3 } from "@loom/house";

export function twoRooms(over: { heightA?: number } = {}): HouseMap {
  const v = validateHouse({
    version: 1,
    name: "test",
    origin: "test",
    floors: [{ id: "g", label: "Ground", elevation: 0, height: 2.5 }],
    rooms: [
      { id: "a", label: "Room A", floor: "g", poly: [[0, 0], [4, 0], [4, 4], [0, 4]], ...(over.heightA !== undefined ? { height: over.heightA } : {}) },
      { id: "b", label: "Room B", floor: "g", poly: [[4, 0], [8, 0], [8, 4], [4, 4]] },
    ],
    doors: [{ id: "d", a: "a", b: "b", at: [4, 2], width: 0.9 }],
    stairs: [],
    terminals: [{ id: "ta", name: "A", room: "a", pos: [0, 1.4, 2], yaw: -90 }],
    duck: { spots: [{ id: "s", room: "b", pos: [7, 0, 2] }] },
    spawn: { room: "a", pos: [1, 0, 1], yaw: 0 },
    props: [],
    spaces: {},
  });
  if (!v.ok || !v.house) throw new Error(v.problems.join("; "));
  return v.house;
}

export const wallsOf = buildWalls;

export function playerState(session: string, p: Vec3, over: Partial<PlayerState> = {}): PlayerState {
  return {
    session,
    guest: `g-${session}`,
    name: `Prog ${session}`,
    world: "web",
    device: "Tent tablet",
    p,
    yaw: 0,
    pitch: 0,
    room: p[0] < 4 ? "a" : "b",
    floor: "g",
    duck: { id: "s", room: "b", pos: [7, 0, 2] },
    found: false,
    startedAt: 0,
    ...over,
  };
}
