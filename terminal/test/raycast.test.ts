import { describe, expect, it } from "vitest";
import { DEFAULT_SPOT_FOV, horizontalFov } from "@loom/house";
import {
  castColumns,
  chaseCamera,
  depthSorted,
  dirOf,
  focalOf,
  followTarget,
  hfovOf,
  hitWall,
  horizonOf,
  internalSize,
  MOUNT_PITCH,
  projectSprite,
  rayWalls,
  rightOf,
  rowOf,
  shade,
  smoothCamera,
  spotCamera,
  visibleRuns,
  wallLight,
  type RayCamera,
} from "../src/raycast/raycast.ts";
import { twoRooms, wallsOf } from "./world-fixture.ts";

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("directions", () => {
  it("yaw 0 faces north (-z), right is east; positive yaw turns left", () => {
    const [fx, fz] = dirOf(0);
    close(fx, 0);
    close(fz, -1);
    const [rx, rz] = rightOf(0);
    close(rx, 1);
    close(rz, 0);
    const [wx] = dirOf(90);
    close(wx, -1);
    const [, nz] = rightOf(90);
    close(nz, -1);
  });
});

describe("the camera", () => {
  it("a placed terminal is a fixed window from its spot (default pitch + fov)", () => {
    const house = twoRooms();
    const cam = spotCamera(house, house.terminals[0]!);
    expect(cam).toEqual({ pos: [0, 1.4, 2], yaw: -90, pitch: MOUNT_PITCH, fov: DEFAULT_SPOT_FOV, floor: "g" });
    expect(spotCamera(house, { ...house.terminals[0]!, pitch: 3, fov: 50 })).toMatchObject({ pitch: 3, fov: 50 });
  });

  it("converts the vertical fov to the horizontal one for the screen's aspect", () => {
    close(hfovOf(70, 1600, 1000), horizontalFov(70, 1.6));
    expect(hfovOf(70, 1600, 900)).toBeGreaterThan(hfovOf(70, 1000, 1000));
  });

  it("the chase camera sits behind the player, pulled in short of a wall behind them", () => {
    const house = twoRooms();
    const walls = wallsOf(house);
    // In the open middle of room B, facing north: 2.4 m south of them fits? Room B is z 0–4: at z 1 there is 3 m south.
    const free = chaseCamera(walls, "g", [6, 0, 1], 0);
    close(free.pos[2], 1 + 2.4);
    expect(free.floor).toBe("g");
    // At z 3 facing north, the south wall (z 4) is 1 m behind: pulled in short of it.
    const pulled = chaseCamera(walls, "g", [6, 0, 3], 0);
    expect(pulled.pos[2]).toBeLessThan(4);
    expect(pulled.pos[2]).toBeGreaterThan(3);
  });

  it("smooths a follow camera, cuts on a floor change", () => {
    const a: RayCamera = { pos: [0, 1, 0], yaw: 170, pitch: 0, fov: 60, floor: "g" };
    const b: RayCamera = { pos: [10, 1, 0], yaw: -170, pitch: 0, fov: 60, floor: "g" };
    const s = smoothCamera(a, b, 0.1);
    expect(s.pos[0]).toBeGreaterThan(0);
    expect(s.pos[0]).toBeLessThan(10);
    expect(s.yaw).toBeGreaterThan(170); // the short way round, through 180
    expect(smoothCamera(a, { ...b, floor: "up" }, 0.1)).toEqual({ ...b, floor: "up" });
    expect(smoothCamera(null, b, 0.1)).toBe(b);
  });
});

describe("projection", () => {
  it("rows: the horizon at the centre, up when looking down; a taller point is higher", () => {
    const f = focalOf(90, 180);
    close(f, 90);
    close(horizonOf(0, 180, f), 90);
    expect(horizonOf(-10, 180, f)).toBeLessThan(90);
    close(rowOf(1.4, 1.4, 5, 90, f), 90);
    expect(rowOf(2.5, 1.4, 5, 90, f)).toBeLessThan(rowOf(0, 1.4, 5, 90, f));
    // Twice as far: half as tall.
    const near = rowOf(0, 1.4, 2, 90, f) - rowOf(2.5, 1.4, 2, 90, f);
    const far = rowOf(0, 1.4, 4, 90, f) - rowOf(2.5, 1.4, 4, 90, f);
    close(near, far * 2);
  });
});

describe("rays", () => {
  it("hits an axis-aligned wall at its perpendicular depth, misses past its ends or behind", () => {
    const wall = { axis: "z" as const, c: 4, lo: 0, hi: 4 };
    const hit = hitWall(wall, 0, 2, 1, 0)!;
    close(hit.t, 4);
    close(hit.u, 2);
    // A slanted ray with forward component 1: t is still the depth (4), u moved along.
    const slant = hitWall(wall, 0, 2, 1, 0.25)!;
    close(slant.t, 4);
    close(slant.u, 3);
    expect(hitWall(wall, 0, 2, 1, 1)).toBeNull(); // u = 6, past the end
    expect(hitWall(wall, 0, 2, -1, 0)).toBeNull(); // behind
    expect(hitWall(wall, 0, 2, 0, 1)).toBeNull(); // parallel
    expect(hitWall({ axis: "x", c: 0, lo: 0, hi: 8 }, 2, 2, 0, -1)!.t).toBeCloseTo(2);
  });

  it("colours each side of a wall by its room", () => {
    const house = twoRooms();
    const a = { ...house.rooms[0]!, color: "#ff0000" };
    const b = { ...house.rooms[1]!, color: "#0000ff" };
    const h = { ...house, rooms: [a, b] };
    const rw = rayWalls(h, wallsOf(h), "g");
    const mid = rw.find((w) => w.axis === "z" && Math.abs(w.c - 4) < 1e-6 && w.kind === "wall")!;
    expect(mid.low[0]).toBe("#ff0000"); // x < 4: room A
    expect(mid.high[0]).toBe("#0000ff");
    expect(rayWalls(h, wallsOf(h), "nowhere")).toEqual([]);
  });

  it("casts the window from room A's west wall: through the door to room B's far wall, A's walls either side", () => {
    const house = twoRooms();
    const cam = spotCamera(house, house.terminals[0]!);
    const { cols, zbuf } = castColumns(rayWalls(house, wallsOf(house), "g"), cam, 160, 90);
    expect(cols).toHaveLength(160);
    // The centre column looks east along z = 2, straight through the door (x 4, z 1.55–2.45): the far wall at x 8.
    close(zbuf[80]!, 8, 0.1);
    // Off to the side the dividing wall at x = 4 stops it.
    expect(zbuf[20]!).toBeLessThan(8);
    // Every column is drawn far to near.
    for (const col of cols) for (let i = 1; i < col.length; i++) expect(col[i - 1]!.depth).toBeGreaterThanOrEqual(col[i]!.depth);
    // The door's lintel hangs over the centre column (nearer than the far wall).
    expect(cols[80]!.some((c) => c.wall.kind === "lintel")).toBe(true);
  });

  it("lights north / south walls more than east / west ones, both dimming with distance", () => {
    expect(wallLight("x", 2)).toBeGreaterThan(wallLight("z", 2));
    expect(wallLight("x", 10)).toBeLessThan(wallLight("x", 2));
    expect(shade("#ff8000", 0.5)).toBe("rgb(128,64,0)");
    expect(shade("#fff", 1)).toBe("rgb(255,255,255)");
    expect(shade("nope", 1)).toBe("rgb(200,200,200)");
  });
});

describe("sprites", () => {
  const cam: RayCamera = { pos: [0, 1.5, 0], yaw: 0, pitch: 0, fov: 90, floor: "g" };

  it("projects a billboard by depth: centred ahead, right is right, half the size twice as far", () => {
    const a = projectSprite(cam, 180, 180, 0, -4, 0, 1.6, 0.6)!;
    close(a.x, 90);
    close(a.depth, 4);
    const b = projectSprite(cam, 180, 180, 0, -8, 0, 1.6, 0.6)!;
    close(a.x1 - a.x0, (b.x1 - b.x0) * 2);
    expect(projectSprite(cam, 180, 180, 1, -4, 0, 1.6, 0.6)!.x).toBeGreaterThan(90);
    expect(projectSprite(cam, 180, 180, 0, 4, 0, 1.6, 0.6)).toBeNull(); // behind
    expect(projectSprite(cam, 180, 180, 50, -1, 0, 1.6, 0.6)).toBeNull(); // far off to the side
  });

  it("clips against the walls column by column", () => {
    const zbuf = [10, 10, 2, 2, 10, 10, Infinity, Infinity];
    expect(visibleRuns(0, 8, 5, zbuf)).toEqual([
      [0, 2],
      [4, 8],
    ]);
    expect(visibleRuns(2, 4, 5, zbuf)).toEqual([]);
    expect(visibleRuns(2, 4, 1, zbuf)).toEqual([[2, 4]]);
    expect(visibleRuns(-5, 1.2, 1, zbuf)).toEqual([[0, 2]]);
  });

  it("paints far first", () => {
    expect(depthSorted([{ depth: 1 }, { depth: 5 }, { depth: 3 }]).map((s) => s.depth)).toEqual([5, 3, 1]);
  });
});

describe("what to look at", () => {
  it("an unplaced terminal follows a fresh find, else the most recently active player", () => {
    const p = (session: string, lastActive: number, foundAt: number | null = null) => ({ session, lastActive, foundAt });
    expect(followTarget([], 0)).toBeNull();
    expect(followTarget([p("a", 10), p("b", 20)], 30)!.session).toBe("b");
    expect(followTarget([p("a", 10, 25), p("b", 20)], 30)!.session).toBe("a");
    expect(followTarget([p("a", 10, 25), p("b", 20)], 25 + 9000)!.session).toBe("b");
  });

  it("renders 180 rows at the box's aspect, 240–400 columns", () => {
    expect(internalSize(1600, 900)).toEqual({ w: 320, h: 180 });
    expect(internalSize(4000, 900)).toEqual({ w: 400, h: 180 });
    expect(internalSize(500, 900)).toEqual({ w: 240, h: 180 });
    expect(internalSize(0, 0)).toEqual({ w: 320, h: 180 });
  });
});
